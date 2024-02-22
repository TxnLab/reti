import { afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import { algoKitLogCaptureFixture, algorandFixture, getTestAccount } from '@algorandfoundation/algokit-utils/testing';
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { Account, encodeAddress, getApplicationAddress } from 'algosdk';
import { LogicError } from '@algorandfoundation/algokit-utils/types/logic-error';
import { transferAlgos } from '@algorandfoundation/algokit-utils';
import { StakingPoolClient } from '../contracts/clients/StakingPoolClient';
import { ValidatorRegistryClient } from '../contracts/clients/ValidatorRegistryClient';
import {
    addStake,
    addStakingPool,
    addValidator,
    createValidatorConfig,
    epochBalanceUpdate,
    getMbrAmountsFromValidatorClient,
    getPoolAvailBalance,
    getPoolInfo,
    getStakedPoolsForAccount,
    getStakeInfoFromBoxValue,
    getStakerInfo,
    getValidatorState,
    logStakingPoolInfo,
    removeStake,
    ValidatorPoolKey,
    verifyRewardAmounts,
} from './helpers';
// import { algoKitLogCaptureFixture } from '@algorandfoundation/algokit-utils/testing'

const fixture = algorandFixture({ testAccountFunding: AlgoAmount.Algos(10000) });
const logs = algoKitLogCaptureFixture();

// algokit.Config.configure({ debug: true });

const MaxAlgoPerPool = AlgoAmount.Algos(100_000).microAlgos;
let validatorMasterClient: ValidatorRegistryClient;
let validatorMasterAppID: number | bigint;
let poolClient: StakingPoolClient;

let validatorMbr: bigint;
let poolMbr: bigint;
let poolInitMbr: bigint;
let stakerMbr: bigint;

// =====
// First construct the 'template' pool and then the master validator contract that everything will use
beforeAll(async () => {
    await fixture.beforeEach();
    // testAccount here is the account that creates the Validator master contracts themselves - but basically one-time thing to be ignored..
    const { algod, testAccount } = fixture.context;

    // First we have to create dummy instance of a pool that we can use as template contract for validator
    // which it can use to create new instances of that contract for staking pool.
    poolClient = new StakingPoolClient({ sender: testAccount, resolveBy: 'id', id: 0 }, algod);
    const tmplPool = await poolClient.create.createApplication({
        creatingContractID: 0,
        validatorID: 0,
        poolID: 0,
        minEntryStake: 1_000_000,
        maxStakeAllowed: 0,
    });
    validatorMasterClient = new ValidatorRegistryClient(
        {
            sender: testAccount,
            resolveBy: 'id',
            id: 0,
            deployTimeParams: {
                NFDRegistryAppID: 0,
            },
        },
        algod
    );

    const validatorApp = await validatorMasterClient.create.createApplication({ poolTemplateAppID: tmplPool.appId });
    // verify that the constructed validator contract is initialized as expected
    expect(validatorApp.appId).toBeDefined();
    expect(validatorApp.appAddress).toBeDefined();
    validatorMasterAppID = validatorApp.appId;

    const validatorGlobalState = await validatorMasterClient.appClient.getGlobalState();
    expect(validatorGlobalState.numV.value).toBe(0);
    expect(validatorGlobalState.foo).toBeUndefined(); // sanity check that undefined states doesn't match 0.

    // need .1 ALGO for things to really work at all w/ this validator contract account so get that out of the way
    await validatorMasterClient.appClient.fundAppAccount(AlgoAmount.Algos(0.1));

    [validatorMbr, poolMbr, poolInitMbr, stakerMbr] = await getMbrAmountsFromValidatorClient(validatorMasterClient);
});

describe('MultValidatorAddCheck', () => {
    beforeEach(fixture.beforeEach);
    beforeEach(logs.beforeEach);
    afterEach(logs.afterEach);

    // Just verify adding new validators and their ids incrementing and mbrs being covered, etc,
    test('validatorAddTests', async () => {
        const validatorOwnerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(500), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        const validatorsAppRef = await validatorMasterClient.appClient.getAppReference();
        const origMbr = (await fixture.context.algod.accountInformation(validatorsAppRef.appAddress).do())[
            'min-balance'
        ];

        const config = createValidatorConfig({
            Owner: validatorOwnerAccount.addr,
            Manager: validatorOwnerAccount.addr,
            ValidatorCommissionAddress: validatorOwnerAccount.addr,
        });
        let expectedID = 1;
        let validatorID = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr
        );
        expect(validatorID).toBe(expectedID);
        const newMbr = (await fixture.context.algod.accountInformation(validatorsAppRef.appAddress).do())[
            'min-balance'
        ];
        expect(newMbr).toBe(origMbr + Number(validatorMbr));

        expectedID += 1;
        validatorID = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr
        );
        expect(validatorID).toBe(expectedID);
        expectedID += 1;
        validatorID = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr
        );
        expect(validatorID).toBe(expectedID);
    });
});

describe('StakeAdds', () => {
    beforeEach(fixture.beforeEach);
    beforeEach(logs.beforeEach);
    afterEach(logs.afterEach);

    let validatorID: number;
    let validatorOwnerAccount: Account;
    let poolAppId: bigint;
    let firstPoolKey: ValidatorPoolKey;

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        // Fund a 'validator account' that will be the validator owner.
        validatorOwnerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(500), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`);

        const config = createValidatorConfig({
            Owner: validatorOwnerAccount.addr,
            Manager: validatorOwnerAccount.addr,
            ValidatorCommissionAddress: validatorOwnerAccount.addr,
            MinEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            MaxAlgoPerPool: BigInt(MaxAlgoPerPool), // this comes into play in later tests !!
            PercentToValidator: 50000, // 5%
        });

        validatorID = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr
        );

        // Add new pool - then we'll add stake and verify balances.
        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorID,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr
        );
        // should be [validator id, pool id (1 based)]
        expect(firstPoolKey.ID).toBe(BigInt(validatorID));
        expect(firstPoolKey.PoolID).toBe(BigInt(1));

        // get the app id via contract call - it should match what we just got back in poolKey[2]
        poolAppId = (
            await validatorMasterClient.getPoolAppId(
                { poolKey: firstPoolKey.encode() },
                { sendParams: { populateAppCallResources: true } }
            )
        ).return!;
        expect(firstPoolKey.PoolAppID).toBe(poolAppId);

        const stateData = await getValidatorState(validatorMasterClient, validatorID);
        expect(stateData.NumPools).toEqual(BigInt(1));
        expect(stateData.TotalAlgoStaked).toEqual(BigInt(0));
        expect(stateData.TotalStakers).toEqual(BigInt(0));

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.PoolAppID).toBe(BigInt(poolAppId));
        expect(poolInfo.TotalStakers).toEqual(0);
        expect(poolInfo.TotalAlgoStaked).toEqual(BigInt(0));
    });

    // Creates dummy staker:
    // adds 'not enough' 1000 algo but taking out staker mbr - fails because <1000 min - checks failure
    // adds 1000 algo (plus enough to cover staker mbr)
    // tries to remove 200 algo (checks failure) because it would go below 1000 algo min.
    // adds 1000 algo more - should end at exactly 2000 algo staked
    test('firstStaker', async () => {
        // get current balance of staker pool (should already include needed MBR in balance - but subtract it out so it's seen as the '0' amount)
        const origStakePoolInfo = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do();

        // Fund a 'staker account' that will be the new 'staker'
        const stakerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(5000), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        // Start by funding 'not enough' (we pay minimum stake [but no mbr]) - should fail (!)
        await expect(
            addStake(fixture.context, validatorMasterClient, validatorID, stakerAccount, AlgoAmount.Algos(1000))
        ).rejects.toThrowError();

        // now stake 1000(+mbr), min for this pool - for the first time - which means actual stake amount will be reduced
        // by 'first time staker' fee to cover MBR (which goes to VALIDATOR contract account, not staker contract account!)
        // we pay the extra here so the final staked amount should be exactly 1000
        const stakeAmount1 = AlgoAmount.MicroAlgos(
            AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
        );
        const stakedPoolKey = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorID,
            stakerAccount,
            stakeAmount1
        );
        // should match info from first staking pool
        expect(stakedPoolKey.ID).toBe(firstPoolKey.ID);
        expect(stakedPoolKey.PoolID).toBe(firstPoolKey.PoolID);
        expect(stakedPoolKey.PoolAppID).toBe(firstPoolKey.PoolAppID);

        let poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.TotalStakers).toEqual(1);
        expect(poolInfo.TotalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)));

        expect((await getValidatorState(validatorMasterClient, validatorID)).TotalStakers).toEqual(BigInt(1));

        const poolBalance1 = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do();
        expect(poolBalance1.amount).toBe(origStakePoolInfo.amount + stakeAmount1.microAlgos - Number(stakerMbr));

        // now try to remove partial amount - which should fail because it will take staked amount to < its 'minimum amount'
        const ourPoolClient = new StakingPoolClient(
            { sender: stakerAccount, resolveBy: 'id', id: stakedPoolKey.PoolAppID },
            fixture.context.algod
        );
        await expect(removeStake(ourPoolClient, stakerAccount, AlgoAmount.Algos(200))).rejects.toThrowError();

        // verify pool stake didn't change!
        poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.TotalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)));
        expect((await getValidatorState(validatorMasterClient, validatorID)).TotalStakers).toEqual(BigInt(1));

        // stake again for 1000 more - should go to same pool (!)
        const stakeAmount2 = AlgoAmount.Algos(1000);
        const stakedKey2 = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorID,
            stakerAccount,
            stakeAmount2
        );
        // should be same as what we added prior
        expect(stakedKey2.ID).toBe(firstPoolKey.ID);
        expect(stakedKey2.PoolID).toBe(firstPoolKey.PoolID);
        expect(stakedKey2.PoolAppID).toBe(firstPoolKey.PoolAppID);
        // verify pool state changed...
        poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.TotalAlgoStaked).toEqual(
            BigInt(stakeAmount1.microAlgos - Number(stakerMbr) + stakeAmount2.microAlgos)
        );
        // ....and verify data for the 'staker' is correct as well
        const stakerInfo = await getStakerInfo(ourPoolClient, stakerAccount);
        expect(encodeAddress(stakerInfo.Staker.publicKey)).toBe(stakerAccount.addr);
        // should be full 2000 algos (we included extra for mbr to begin with)
        expect(stakerInfo.Balance).toEqual(BigInt(AlgoAmount.Algos(2000).microAlgos));

        expect((await getValidatorState(validatorMasterClient, validatorID)).TotalStakers).toEqual(BigInt(1));

        // let's also get list of all staked pools we're part of... should only contain 1 entry and just be our pool
        const allPools = await getStakedPoolsForAccount(validatorMasterClient, stakerAccount);
        expect(allPools).toHaveLength(1);
        expect(allPools[0]).toEqual(firstPoolKey);

        // second balance check of pool - it should increase by full stake amount since existing staker staked again, so no additional
        // mbr was needed
        const poolBalance2 = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do();
        expect(poolBalance2.amount).toBe(poolBalance1.amount + stakeAmount2.microAlgos);

        const stakerAcctBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do();
        expect(stakerAcctBalance.amount).toBe(
            AlgoAmount.Algos(5000).microAlgos - // funded amount
                stakeAmount1.microAlgos -
                stakeAmount2.microAlgos -
                AlgoAmount.Algos(0.006 * 2).microAlgos /* 6 txn fee cost per staking */
        );

        // Verify 'total' staked from validator contract
        const stateData = await getValidatorState(validatorMasterClient, validatorID);
        expect(stateData.NumPools).toEqual(BigInt(1));
        expect(stateData.TotalAlgoStaked).toEqual(
            BigInt(stakeAmount1.microAlgos + stakeAmount2.microAlgos - Number(stakerMbr))
        );
        expect(stateData.TotalStakers).toEqual(BigInt(1));
    });

    // Creates new staker account
    // Adds 2000 algo to pool (not caring about mbr - so actual amount will be less the stakermbr amount)
    test('nextStaker', async () => {
        // get current balance of staker pool
        const origStakePoolInfo = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do();
        // and of all pools
        const origValidatorState = await getValidatorState(validatorMasterClient, validatorID);

        // Fund a 'staker account' that will be the new 'staker'
        const stakerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(5000), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        // add 2000 stake by random staker - should go to NEW slot - but this is still their first add so they have to pay more mbr
        // this time - since it's over minimum... don't pay 'extra' - so we should ensure that the MBR is NOT part of what we stake
        const stakeAmount1 = AlgoAmount.Algos(2000);
        const stakedPoolKey = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorID,
            stakerAccount,
            stakeAmount1
        );
        // should be same as what we added prior
        expect(stakedPoolKey.ID).toBe(firstPoolKey.ID);
        expect(stakedPoolKey.PoolID).toBe(firstPoolKey.PoolID);
        expect(stakedPoolKey.PoolAppID).toBe(firstPoolKey.PoolAppID);

        const poolBalance1 = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do();
        expect(poolBalance1.amount).toBe(origStakePoolInfo.amount + stakeAmount1.microAlgos - Number(stakerMbr));

        const stakerAcctBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do();
        expect(stakerAcctBalance.amount).toBe(
            AlgoAmount.Algos(5000).microAlgos - // funded amount
                stakeAmount1.microAlgos -
                AlgoAmount.Algos(0.006 * 1).microAlgos /* 6 txn fee cost per staking */
        );

        // let's also get list of all staked pools we're part of... should only contain 1 entry and just be our pool
        const allPools = await getStakedPoolsForAccount(validatorMasterClient, stakerAccount);
        expect(allPools).toHaveLength(1);
        expect(allPools[0]).toEqual(firstPoolKey);

        // Verify 'total' staked from validator contract
        const stateData = await getValidatorState(validatorMasterClient, validatorID);
        expect(stateData.NumPools).toEqual(BigInt(1));
        expect(stateData.TotalAlgoStaked).toEqual(
            origValidatorState.TotalAlgoStaked + BigInt(stakeAmount1.microAlgos - Number(stakerMbr))
        );
        expect(stateData.TotalStakers).toEqual(BigInt(2));
    });

    test('validatorPoolCheck', async () => {
        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.PoolAppID).toBe(BigInt(poolAppId));
        expect(poolInfo.TotalStakers).toBe(2);
        expect(poolInfo.TotalAlgoStaked).toBe(BigInt(AlgoAmount.Algos(4000).microAlgos - Number(stakerMbr)));
    });

    test('add3PoolsAndFill', async () => {
        const pools = [];
        const stakers = [];
        const poolsToCreate = 4;

        // capture current 'total' state for all pools
        const origValidatorState = await getValidatorState(validatorMasterClient, validatorID);

        // we create 4 new pools (on top of the first pool we added as part of beforeAll)
        for (let i = 0; i < poolsToCreate; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            const newPool = await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorID,
                validatorOwnerAccount,
                poolMbr,
                poolInitMbr
            );
            expect(newPool.PoolID).toBe(BigInt(2 + i));
            pools.push(newPool);
        }

        for (let i = 0; i < poolsToCreate; i += 1) {
            const poolInfo = await getPoolInfo(validatorMasterClient, pools[i]);
            expect(poolInfo.PoolAppID).toBe(pools[i].PoolAppID);
            expect(poolInfo.TotalStakers).toEqual(0);
            expect(poolInfo.TotalAlgoStaked).toEqual(BigInt(0));
        }

        // now create 4 new stakers
        for (let i = 0; i < poolsToCreate; i += 1) {
            // fund some new staker accounts (4)
            const stakerAccount = await getTestAccount(
                {
                    initialFunds: AlgoAmount.MicroAlgos(MaxAlgoPerPool + AlgoAmount.Algos(4000).microAlgos),
                    suppressLog: true,
                },
                fixture.context.algod,
                fixture.context.kmd
            );
            stakers.push(stakerAccount);
        }
        // have the first 3 of the 4 new stakers - add such that each pool is basically completely full but just
        // short so we can still add a small amount later in a test.
        // add stake for each - each time should work and go to new pool (starting with first pool we added - the one
        // that's already there shouldn't have room).  Then next add of same size should fail.. then next add of something
        // small should go to first pool again
        const stakeAmount = AlgoAmount.MicroAlgos(MaxAlgoPerPool - AlgoAmount.Algos(1000).microAlgos);
        for (let i = 0; i < poolsToCreate - 1; i += 1) {
            const stakedPoolKey = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorID,
                stakers[i],
                stakeAmount
            );
            // should go to each pool in succession since it's basically the entire pool
            expect(stakedPoolKey.ID).toBe(pools[i].ID);
            expect(stakedPoolKey.PoolID).toBe(pools[i].PoolID);
            expect(stakedPoolKey.PoolAppID).toBe(pools[i].PoolAppID);

            expect(await getStakedPoolsForAccount(validatorMasterClient, stakers[i])).toEqual([stakedPoolKey]);
        }
        // now try to add larger stake from staker 4... should fail... nothing free
        await expect(
            addStake(
                fixture.context,
                validatorMasterClient,
                validatorID,
                stakers[3],
                AlgoAmount.MicroAlgos(MaxAlgoPerPool + AlgoAmount.Algos(1000).microAlgos)
            )
        ).rejects.toThrowError();

        // For staker 4 - get their staked pool list - should be empty
        expect(await getStakedPoolsForAccount(validatorMasterClient, stakers[3])).toHaveLength(0);
        // have staker4 stake large amount - just barely under max - so should only fit in last pool
        const fitTestStake1 = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorID,
            stakers[3],
            AlgoAmount.MicroAlgos(MaxAlgoPerPool - AlgoAmount.Algos(1000).microAlgos)
        );
        expect(fitTestStake1.ID).toBe(pools[3].ID);
        expect(fitTestStake1.PoolID).toBe(pools[3].PoolID);
        expect(fitTestStake1.PoolAppID).toBe(pools[3].PoolAppID);

        // Now have staker 4 stake 1000 - it'll fit in last pool (just) since it first tries pools staker is already in
        const fitTestStake2 = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorID,
            stakers[3],
            AlgoAmount.Algos(1000)
        );
        expect(fitTestStake2.ID).toBe(pools[3].ID);
        expect(fitTestStake2.PoolID).toBe(pools[3].PoolID);
        expect(fitTestStake2.PoolAppID).toBe(pools[3].PoolAppID);

        // now try to add smallish stake from staker 4... should go to very first pool
        // # of stakers shouldn't increase!  They're new entrant into pool but already staked somewhere else !
        const fitTestStake3 = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorID,
            stakers[3],
            AlgoAmount.Algos(1000)
        );
        expect(fitTestStake3.ID).toBe(firstPoolKey.ID);
        expect(fitTestStake3.PoolID).toBe(firstPoolKey.PoolID);
        expect(fitTestStake3.PoolAppID).toBe(firstPoolKey.PoolAppID);

        // For staker 4 - get their staked pool list - should now be two entries - pool 5 (pool 4 we added) then pool 1 (order of staking)
        const lastStakerPools = await getStakedPoolsForAccount(validatorMasterClient, stakers[3]);
        expect(lastStakerPools).toHaveLength(2);
        expect(lastStakerPools[0]).toEqual(pools[3]);
        expect(lastStakerPools[1]).toEqual(firstPoolKey);

        // Get 'total' staked from validator contract
        const stateData = await getValidatorState(validatorMasterClient, validatorID);
        consoleLogger.info(
            `num pools: ${stateData.NumPools}, total staked:${stateData.TotalAlgoStaked}, stakers:${stateData.TotalStakers}`
        );
        expect(stateData.NumPools).toEqual(BigInt(5));
        expect(stateData.TotalAlgoStaked).toEqual(
            origValidatorState.TotalAlgoStaked +
                BigInt(stakeAmount.microAlgos * 4) -
                BigInt(stakerMbr * BigInt(4)) +
                BigInt(AlgoAmount.Algos(2000).microAlgos)
        );
        expect(stateData.TotalStakers).toEqual(BigInt(6));

        // let i = 0;
        // stakers.forEach((staker) => {
        //     consoleLogger.info(`staker ${i}: ${staker.addr}`)
        //     i+=1;
        // })
    });

    test('addThenRemoveStake', async () => {
        const stakerAccount = await getTestAccount(
            {
                initialFunds: AlgoAmount.Algos(10_000),
                suppressLog: true,
            },
            fixture.context.algod,
            fixture.context.kmd
        );
        let amountStaked = 0;
        // smallish amount of stake - should just get added to first pool
        const addStake1 = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorID,
            stakerAccount,
            AlgoAmount.Algos(1100)
        );
        amountStaked += AlgoAmount.Algos(1100).microAlgos;
        expect(addStake1.ID).toBe(firstPoolKey.ID);
        expect(addStake1.PoolID).toBe(firstPoolKey.PoolID);
        expect(addStake1.PoolAppID).toBe(firstPoolKey.PoolAppID);

        // add again.. should go to same place
        const addStake2 = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorID,
            stakerAccount,
            AlgoAmount.Algos(2000)
        );
        amountStaked += AlgoAmount.Algos(2000).microAlgos;

        expect(addStake2.ID).toBe(firstPoolKey.ID);
        expect(addStake2.PoolID).toBe(firstPoolKey.PoolID);
        expect(addStake2.PoolAppID).toBe(firstPoolKey.PoolAppID);

        const stakerAcctBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do();
        expect(stakerAcctBalance.amount).toBe(
            AlgoAmount.Algos(10_000).microAlgos - // funded amount
                amountStaked -
                AlgoAmount.Algos(0.006 * 2).microAlgos /* 6 txn fee cost per staking */
        );

        // Verify the staked data matches....
        const allPools = await getStakedPoolsForAccount(validatorMasterClient, stakerAccount);
        expect(allPools).toHaveLength(1);
        expect(allPools[0]).toEqual(firstPoolKey);
        // ....and verify data for the 'staker' is correct as well
        const ourPoolClient = new StakingPoolClient(
            { sender: stakerAccount, resolveBy: 'id', id: firstPoolKey.PoolAppID },
            fixture.context.algod
        );
        // The amount 'actually' staked won't include the MBR amount
        const stakerInfo = await getStakerInfo(ourPoolClient, stakerAccount);
        expect(encodeAddress(stakerInfo.Staker.publicKey)).toBe(stakerAccount.addr);
        expect(stakerInfo.Balance).toEqual(BigInt(amountStaked - Number(stakerMbr)));

        // Get Pool info before removing stake..
        const preRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);

        // then remove the stake !
        await removeStake(ourPoolClient, stakerAccount, AlgoAmount.MicroAlgos(Number(stakerInfo.Balance)));
        const newBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do();
        expect(newBalance.amount).toBe(
            stakerAcctBalance.amount + Number(stakerInfo.Balance) - 5000 /* microAlgo for removeStake fees */
        );

        // stakers should have been reduced and stake amount should have been reduced by stake removed
        const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(postRemovePoolInfo.TotalStakers).toBe(preRemovePoolInfo.TotalStakers - 1);
        expect(postRemovePoolInfo.TotalAlgoStaked).toBe(preRemovePoolInfo.TotalAlgoStaked - stakerInfo.Balance);
    });

    test('addThenRemoveAllStake', async () => {
        const stakerAccount = await getTestAccount(
            {
                initialFunds: AlgoAmount.Algos(10_000),
                suppressLog: true,
            },
            fixture.context.algod,
            fixture.context.kmd
        );
        let amountStaked = 0;
        // smallish amount of stake - should just get added to first pool
        const addStake1 = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorID,
            stakerAccount,
            AlgoAmount.Algos(1100)
        );
        amountStaked += AlgoAmount.Algos(1100).microAlgos;
        expect(addStake1.ID).toBe(firstPoolKey.ID);
        expect(addStake1.PoolID).toBe(firstPoolKey.PoolID);
        expect(addStake1.PoolAppID).toBe(firstPoolKey.PoolAppID);

        const stakerAcctBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do();
        expect(stakerAcctBalance.amount).toBe(
            AlgoAmount.Algos(10_000).microAlgos - // funded amount
                amountStaked -
                AlgoAmount.Algos(0.006 * 1).microAlgos /* 6 txn fee cost per staking */
        );

        // Verify the staked data matches....
        const allPools = await getStakedPoolsForAccount(validatorMasterClient, stakerAccount);
        expect(allPools).toHaveLength(1);
        expect(allPools[0]).toEqual(firstPoolKey);
        // ....and verify data for the 'staker' is correct as well
        const ourPoolClient = new StakingPoolClient(
            { sender: stakerAccount, resolveBy: 'id', id: firstPoolKey.PoolAppID },
            fixture.context.algod
        );
        // The amount 'actually' staked won't include the MBR amount
        const stakerInfo = await getStakerInfo(ourPoolClient, stakerAccount);
        expect(encodeAddress(stakerInfo.Staker.publicKey)).toBe(stakerAccount.addr);
        expect(stakerInfo.Balance).toEqual(BigInt(amountStaked - Number(stakerMbr)));

        // Get Pool info before removing stake..
        const preRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);

        // then remove ALL the stake  (specifying 0 to remove all)
        await removeStake(ourPoolClient, stakerAccount, AlgoAmount.MicroAlgos(0));
        const newBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do();
        expect(newBalance.amount).toBe(
            stakerAcctBalance.amount + Number(stakerInfo.Balance) - 5000 /* microAlgo for removeStake fees */
        );

        // stakers should have been reduced and stake amount should have been reduced by stake removed
        const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(postRemovePoolInfo.TotalStakers).toBe(preRemovePoolInfo.TotalStakers - 1);
        expect(postRemovePoolInfo.TotalAlgoStaked).toBe(preRemovePoolInfo.TotalAlgoStaked - stakerInfo.Balance);
    });

    test('getStakeInfo', async () => {
        await logStakingPoolInfo(fixture.context, firstPoolKey.PoolAppID, 'getStakeInfo');
    });

    async function tryCatchWrapper(instance: any, methodName: string, ...args: any[]) {
        try {
            return await instance[methodName](...args);
        } catch (exception) {
            console.log((exception as LogicError).message);
            throw exception;
        }
    }
});

describe('StakeWRewards', () => {
    beforeEach(fixture.beforeEach);
    beforeEach(logs.beforeEach);
    afterEach(logs.afterEach);

    let validatorID: number;
    let validatorOwnerAccount: Account;
    const stakerAccounts: Account[] = [];
    let poolAppId: bigint;
    let firstPoolKey: ValidatorPoolKey;
    let firstPoolClient: StakingPoolClient;

    const PctToValidator = 5;

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        // Fund a 'validator account' that will be the validator owner.
        validatorOwnerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(500), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`);

        const config = createValidatorConfig({
            Owner: validatorOwnerAccount.addr,
            Manager: validatorOwnerAccount.addr,
            MinEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            MaxAlgoPerPool: BigInt(MaxAlgoPerPool), // this comes into play in later tests !!
            PercentToValidator: PctToValidator * 10000,
            ValidatorCommissionAddress: validatorOwnerAccount.addr,
        });
        validatorID = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr
        );

        // Add new pool - then we'll add stake and verify balances.
        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorID,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr
        );
        // should be [validator id, pool id (1 based)]
        expect(firstPoolKey.ID).toBe(BigInt(validatorID));
        expect(firstPoolKey.PoolID).toBe(BigInt(1));

        firstPoolClient = new StakingPoolClient(
            { sender: validatorOwnerAccount, resolveBy: 'id', id: firstPoolKey.PoolAppID },
            fixture.context.algod
        );

        // get the app id via contract call - it should match what we just got back in poolKey[2]
        poolAppId = (
            await validatorMasterClient.getPoolAppId(
                { poolKey: firstPoolKey.encode() },
                { sendParams: { populateAppCallResources: true } }
            )
        ).return!;
        expect(firstPoolKey.PoolAppID).toBe(poolAppId);

        const stateData = await getValidatorState(validatorMasterClient, validatorID);
        expect(stateData.NumPools).toEqual(BigInt(1));
        expect(stateData.TotalAlgoStaked).toEqual(BigInt(0));
        expect(stateData.TotalStakers).toEqual(BigInt(0));

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.PoolAppID).toBe(BigInt(poolAppId));
        expect(poolInfo.TotalStakers).toEqual(0);
        expect(poolInfo.TotalAlgoStaked).toEqual(BigInt(0));
    });

    // Creates dummy staker:
    // adds 'not enough' 1000 algo but taking out staker mbr - fails because <1000 min - checks failure
    // adds 1000 algo (plus enough to cover staker mbr)
    // tries to remove 200 algo (checks failure) because it would go below 1000 algo min.
    // adds 1000 algo more - should end at exactly 2000 algo staked
    test('firstStaker', async () => {
        // get current balance of staker pool (should already include needed MBR in balance - but subtract it out so it's seen as the '0' amount)
        // const origStakePoolInfo = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do();

        // Fund a 'staker account' that will be the new 'staker'
        const stakerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(5000), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        stakerAccounts.push(stakerAccount);

        // now stake 1000(+mbr), min for this pool - for the first time - which means actual stake amount will be reduced
        // by 'first time staker' fee to cover MBR (which goes to VALIDATOR contract account, not staker contract account!)
        // we pay the extra here so the final staked amount should be exactly 1000
        const stakeAmount1 = AlgoAmount.MicroAlgos(
            AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
        );
        const stakedPoolKey = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorID,
            stakerAccount,
            stakeAmount1
        );
        // should match info from first staking pool
        expect(stakedPoolKey.ID).toBe(firstPoolKey.ID);
        expect(stakedPoolKey.PoolID).toBe(firstPoolKey.PoolID);
        expect(stakedPoolKey.PoolAppID).toBe(firstPoolKey.PoolAppID);

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.TotalStakers).toEqual(1);
        expect(poolInfo.TotalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)));

        expect((await getValidatorState(validatorMasterClient, validatorID)).TotalStakers).toEqual(BigInt(1));
    });

    test('testFirstRewards', async () => {
        // increment time a day at a time per transaction
        await fixture.context.algod.setBlockOffsetTimestamp(60 * 60 * 24).do();

        const origValidatorState = await getValidatorState(validatorMasterClient, validatorID);
        const ownerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do();
        const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient);

        const reward = AlgoAmount.Algos(200);
        // put some test 'reward' algos into staking pool
        await transferAlgos(
            {
                from: fixture.context.testAccount,
                to: getApplicationAddress(firstPoolKey.PoolAppID),
                amount: reward,
            },
            fixture.context.algod
        );

        // stakers should have been reduced and stake amount should have been reduced by stake removed
        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        consoleLogger.info(`pool stakers:${poolInfo.TotalStakers}, staked:${poolInfo.TotalAlgoStaked}`);

        // Perform epoch payout calculation  - we get back how much it cost to issue the txn
        const fees = await epochBalanceUpdate(firstPoolClient);
        const expectedValidatorReward = reward.microAlgos * (PctToValidator / 100);

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorID);
        const newOwnerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do();
        // validator owner should have gotten the expected reward (minus the fees they just paid ofc)
        expect(newOwnerBalance.amount).toBe(ownerBalance.amount - fees.microAlgos + expectedValidatorReward);

        // Verify all the stakers in the pool got what we think they should have
        const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient);

        verifyRewardAmounts(
            BigInt(reward.microAlgos) - BigInt(expectedValidatorReward),
            stakersPriorToReward,
            stakersAfterReward
        );

        // the total staked should have grown as well - reward minus what the validator was paid in their commission
        expect(Number(newValidatorState.TotalAlgoStaked)).toBe(
            Number(origValidatorState.TotalAlgoStaked) + (reward.microAlgos - expectedValidatorReward)
        );

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey);
        expect(poolBalance).toBe(newValidatorState.TotalAlgoStaked);
    });

    test('extractRewards', async () => {
        const origStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[0].addr).do();

        // Remove it all
        await removeStake(firstPoolClient, stakerAccounts[0], AlgoAmount.Algos(1190));

        const newStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[0].addr).do();
        // 1000 algos staked + 190 reward (- .004 in fees for removing stake)
        expect(newStakerBalance.amount).toBe(
            origStakerBalance.amount + AlgoAmount.Algos(1190).microAlgos - AlgoAmount.MicroAlgos(4000).microAlgos
        );

        // no one should be left and be 0 balance
        const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(postRemovePoolInfo.TotalStakers).toBe(0);
        expect(postRemovePoolInfo.TotalAlgoStaked).toBe(BigInt(0));

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorID);
        expect(Number(newValidatorState.TotalAlgoStaked)).toBe(0);
        expect(Number(newValidatorState.TotalStakers)).toBe(0);

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey);
        expect(poolBalance).toBe(newValidatorState.TotalAlgoStaked);
    });

    test('testFailNotEnoughRewards', async () => {
        // Do epoch payout immediately with no new funds - should fail because not enough to pay out to validator, etc.
        await expect(epochBalanceUpdate(firstPoolClient)).rejects.toThrowError();
    });

    test('testTooEarlyEpoch', async () => {
        // increment 1 hour at a time per transaction
        await fixture.context.algod.setBlockOffsetTimestamp(60 * 60).do();

        // put some test 'reward' algos into staking pool
        await transferAlgos(
            {
                from: fixture.context.testAccount,
                to: getApplicationAddress(firstPoolKey.PoolAppID),
                amount: AlgoAmount.Algos(100),
            },
            fixture.context.algod
        );

        // this payout should work... between prior tests and just now - it's been a day..
        // validator will have received 5 algo (on the 100 we just put in the pool) - we account for that later...
        const fees = await epochBalanceUpdate(firstPoolClient);

        await transferAlgos(
            {
                from: fixture.context.testAccount,
                to: getApplicationAddress(firstPoolKey.PoolAppID),
                amount: AlgoAmount.Algos(100),
            },
            fixture.context.algod
        );
        // We added more again - but enough time shouldn't have passed to allow another payout
        await expect(epochBalanceUpdate(firstPoolClient)).rejects.toThrowError();

        // and staked amount should still be 0
        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.TotalStakers).toEqual(0);
        expect(poolInfo.TotalAlgoStaked).toEqual(BigInt(0));

        await logStakingPoolInfo(fixture.context, firstPoolKey.PoolAppID, 'should be no stakers !');

        // We added 200 algo in to bump the clock a bit - and cause transactions - this is basically future reward
        // we did 1 payout - so balance should be 200 - (validator % of 100)
        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey);
        expect(poolBalance).toBe(
            BigInt(AlgoAmount.Algos(200).microAlgos) - BigInt(AlgoAmount.Algos(100).microAlgos * (PctToValidator / 100))
        );
        consoleLogger.info(`ending pool balance: ${poolBalance}`);
    });

    test('testPartialReward', async () => {
        // increment 1 hour at a time per transaction
        await fixture.context.algod.setBlockOffsetTimestamp(60 * 60).do();

        // loop until we get a payout (from prior 'too early' state)
        let algoAdded = 0;
        while (true) {
            try {
                const fees = await epochBalanceUpdate(firstPoolClient);
                break;
            } catch (exception) {
                // move the clock by issuing a txn.
                await transferAlgos(
                    {
                        from: fixture.context.testAccount,
                        to: getApplicationAddress(firstPoolKey.PoolAppID),
                        amount: AlgoAmount.Algos(10),
                    },
                    fixture.context.algod
                );
                algoAdded = AlgoAmount.Algos(10).microAlgos;
            }
        }

        // double-check no one should be left and be 0 balance
        const checkPoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(checkPoolInfo.TotalStakers).toBe(0);
        expect(checkPoolInfo.TotalAlgoStaked).toBe(BigInt(0));

        const checkValidatorState = await getValidatorState(validatorMasterClient, validatorID);
        expect(Number(checkValidatorState.TotalAlgoStaked)).toBe(0);
        expect(Number(checkValidatorState.TotalStakers)).toBe(0);

        // Ok, re-enter the pool - but now we know it will be a 'partial' entry into the epoch (so we can ensure partial
        // payout occurs)
        // now stake 1000(+mbr), min for this pool - for the first time - which means actual stake amount will be reduced
        // by 'first time staker' fee to cover MBR (which goes to VALIDATOR contract account, not staker contract account!)
        // we pay the extra here so the final staked amount should be exactly 1000
        const stakeAmount1 = AlgoAmount.Algos(1000);
        // Add stake for first staker - partial epoch
        const aPoolKey = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorID,
            stakerAccounts[0],
            stakeAmount1
        );
        expect(aPoolKey.PoolAppID).toBe(aPoolKey.PoolAppID);

        const staker1Info = await getStakerInfo(firstPoolClient, stakerAccounts[0]);
        const entryTime = new Date(Number(staker1Info.EntryTime) * 1000); // convert to ms
        const stakingPoolGS = await firstPoolClient.appClient.getGlobalState();
        const lastPayoutTime = new Date(Number(stakingPoolGS.lastPayout.value as bigint) * 1000);
        consoleLogger.info(`lastPayout:${lastPayoutTime.toString()}, new entry time: ${entryTime.toString()}`);

        // Ok - bump time so that the next staker is in the entire time
        await fixture.context.algod.setBlockOffsetTimestamp(60 * 60 * 24).do();

        // Add second (brand new!) staker - with same amount entered
        const fullEpochStaker = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(5000), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        stakerAccounts.push(fullEpochStaker);
        const stakeAmount2 = AlgoAmount.MicroAlgos(
            AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
        );

        // Add stake for full-epoch staker
        const newPoolKey = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorID,
            fullEpochStaker,
            stakeAmount2
        );

        expect(newPoolKey.PoolAppID).toBe(aPoolKey.PoolAppID);
        const staker2Info = await getStakerInfo(firstPoolClient, fullEpochStaker);
        const staker2Entry = new Date(Number(staker2Info.EntryTime) * 1000);
        expect((staker2Entry.getTime() - lastPayoutTime.getTime()) / 1000).toBeGreaterThanOrEqual(60 * 60 * 24); // has to be at least a day

        await logStakingPoolInfo(fixture.context, firstPoolKey.PoolAppID, 'should have two stakers');

        // ok now do payout - and see if we can figure out the payouts
        // get
        // do payout -
        // This is
        const poolInfo = await getPoolInfo(validatorMasterClient, aPoolKey);
        expect(poolInfo.TotalStakers).toEqual(2);
        // only subtract out 1 staker mbr because only the 'fullEpochStaker' will be 'new' to staking
        expect(poolInfo.TotalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos + stakeAmount2.microAlgos) - stakerMbr);

        // What's pool's current balance
        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey);
        const knownReward = poolBalance - poolInfo.TotalAlgoStaked;
        const expectedValidatorReward = Number(knownReward) * (PctToValidator / 100);

        const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient);

        // do reward calcs
        await epochBalanceUpdate(firstPoolClient);
        //
        // expect((await getValidatorState(validatorClient, validatorID)).TotalStakers).toEqual(BigInt(1));
        const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient);

        await logStakingPoolInfo(fixture.context, firstPoolKey.PoolAppID, 'after payouts');
        // verifyRewardAmounts(knownReward - BigInt(expectedValidatorReward), stakersPriorToReward, stakersAfterReward);
    });

    async function tryCatchWrapper(instance: any, methodName: string, ...args: any[]) {
        try {
            return await instance[methodName](...args);
        } catch (exception) {
            console.log((exception as LogicError).message);
            throw exception;
        }
    }
});
