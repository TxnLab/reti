import { afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import { algoKitLogCaptureFixture, algorandFixture, getTestAccount } from '@algorandfoundation/algokit-utils/testing';
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { Account, decodeAddress, encodeAddress, getApplicationAddress } from 'algosdk';
import { assetOptIn, transferAlgos, transferAsset } from '@algorandfoundation/algokit-utils';
import { StakingPoolClient } from '../contracts/clients/StakingPoolClient';
import { ValidatorRegistryClient } from '../contracts/clients/ValidatorRegistryClient';
import {
    addStake,
    addStakingPool,
    addValidator,
    ALGORAND_ZERO_ADDRESS_STRING,
    claimTokens,
    createAsset,
    createValidatorConfig,
    epochBalanceUpdate,
    GATING_TYPE_ASSET_ID,
    GATING_TYPE_ASSETS_CREATED_BY,
    getCurMaxStatePerPool,
    getMbrAmountsFromValidatorClient,
    getPoolAvailBalance,
    getPoolInfo,
    getProtocolConstraints,
    getStakedPoolsForAccount,
    getStakeInfoFromBoxValue,
    getStakerInfo,
    getTokenPayoutRatio,
    getValidatorState,
    logStakingPoolInfo,
    ProtocolConstraints,
    removeStake,
    StakedInfo,
    ValidatorConfig,
    ValidatorPoolKey,
    verifyRewardAmounts,
} from './helpers';

const FEE_SINK_ADDR = 'Y76M3MSY6DKBRHBL7C3NNDXGS5IIMQVQVUAB6MP4XEMMGVF2QWNPL226CA';

const MaxPoolsPerNode = 3;
// Periodically set this to max amount allowed in protocol (200 atm) but when testing more frequently this should be lowered to something like 20 stakers
// The ValidatorWFullPoolWRewards test is 'skip'ped for now - but should be periodically enabled for testing.
const MaxStakersPerPool = 200;

const fixture = algorandFixture({ testAccountFunding: AlgoAmount.Algos(10000) });
const logs = algoKitLogCaptureFixture();

// algokit.Config.configure({ debug: true });

const MaxAlgoPerPool = AlgoAmount.Algos(100_000).microAlgos;
let validatorMasterClient: ValidatorRegistryClient;
let poolClient: StakingPoolClient;

let validatorMbr: bigint;
let poolMbr: bigint;
let poolInitMbr: bigint;
let stakerMbr: bigint;

// =====
// First construct the 'template' pool and then the master validator contract that everything will use
beforeAll(async () => {
    await fixture.beforeEach();
    // testAccount here is the account that creates the Validator master contracts themselves - but basically one-time thing to be ignored
    const { algod, testAccount } = fixture.context;

    // First we have to create dummy instance of a pool that we can use as template contract for validator
    // which it can use to create new instances of that contract for staking pool.
    poolClient = new StakingPoolClient(
        {
            sender: testAccount,
            resolveBy: 'id',
            id: 0,
            deployTimeParams: {
                nfdRegistryAppId: 0,
                feeSinkAddr: decodeAddress(FEE_SINK_ADDR).publicKey,
            },
        },
        algod
    );
    const tmplPool = await poolClient.create.createApplication({
        creatingContractId: 0,
        validatorId: 0,
        poolId: 0,
        minEntryStake: 1_000_000,
    });
    validatorMasterClient = new ValidatorRegistryClient(
        {
            sender: testAccount,
            resolveBy: 'id',
            id: 0,
            deployTimeParams: {
                nfdRegistryAppId: 0,
            },
        },
        algod
    );

    const validatorApp = await validatorMasterClient.create.createApplication({ poolTemplateAppId: tmplPool.appId });
    // verify that the constructed validator contract is initialized as expected
    expect(validatorApp.appId).toBeDefined();
    expect(validatorApp.appAddress).toBeDefined();

    const validatorGlobalState = await validatorMasterClient.appClient.getGlobalState();
    expect(validatorGlobalState.numV.value).toEqual(0);
    expect(validatorGlobalState.foo).toBeUndefined(); // sanity check that undefined states doesn't match 0.

    // need .1 ALGO for things to really work at all w/ this validator contract account so get that out of the way
    await validatorMasterClient.appClient.fundAppAccount(AlgoAmount.Algos(0.1));

    [validatorMbr, poolMbr, poolInitMbr, stakerMbr] = await getMbrAmountsFromValidatorClient(validatorMasterClient);
});

describe('MultValidatorAddCheck', () => {
    beforeEach(fixture.beforeEach);
    beforeEach(logs.beforeEach);
    afterEach(logs.afterEach);

    // Just verify adding new validators and their ids incrementing and mbrs being covered, etc.,
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
        let validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr
        );
        expect(validatorId).toEqual(expectedID);
        const newMbr = (await fixture.context.algod.accountInformation(validatorsAppRef.appAddress).do())[
            'min-balance'
        ];
        expect(newMbr).toEqual(origMbr + Number(validatorMbr));

        expectedID += 1;
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr
        );
        expect(validatorId).toEqual(expectedID);
        expectedID += 1;
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr
        );
        expect(validatorId).toEqual(expectedID);
    });
});

describe('StakeAdds', () => {
    beforeEach(fixture.beforeEach);
    beforeEach(logs.beforeEach);
    afterEach(logs.afterEach);

    let validatorId: number;
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
            PoolsPerNode: MaxPoolsPerNode,
        });

        validatorId = await addValidator(
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
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr
        );
        // should be [validator id, pool id (1 based)]
        expect(firstPoolKey.id).toEqual(BigInt(validatorId));
        expect(firstPoolKey.poolId).toEqual(1n);

        // get the app id via contract call - it should match what we just got back in poolKey[2]
        poolAppId = (
            await validatorMasterClient.getPoolAppId(
                { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                { sendParams: { populateAppCallResources: true } }
            )
        ).return!;
        expect(firstPoolKey.poolAppId).toEqual(poolAppId);

        const stateData = await getValidatorState(validatorMasterClient, validatorId);
        expect(stateData.numPools).toEqual(1);
        expect(stateData.totalAlgoStaked).toEqual(0n);
        expect(stateData.totalStakers).toEqual(0n);

        const validatorGlobalState = await validatorMasterClient.appClient.getGlobalState();
        expect(validatorGlobalState.staked.value).toEqual(0);
        expect(validatorGlobalState.numStakers.value).toEqual(0);

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.poolAppId).toEqual(BigInt(poolAppId));
        expect(poolInfo.totalStakers).toEqual(0);
        expect(poolInfo.totalAlgoStaked).toEqual(0n);
    });

    // Creates dummy staker:
    // adds 'not enough' 1000 algo but taking out staker mbr - fails because <1000 min - checks failure
    // adds 1000 algo (plus enough to cover staker mbr)
    // tries to remove 200 algo (checks failure) because it would go below 1000 algo min.
    // adds 1000 algo more - should end at exactly 2000 algo staked
    test('firstStaker', async () => {
        // get current balance of staker pool (should already include needed MBR in balance - but subtract it out, so it's seen as the '0' amount)
        const origStakePoolInfo = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do();

        // Fund a 'staker account' that will be the new 'staker'
        const stakerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(5000), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        // Start by funding 'not enough' (we pay minimum stake [but no mbr]) - should fail (!)
        await expect(
            addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, AlgoAmount.Algos(1000), 0n)
        ).rejects.toThrowError();

        // now stake 1000(+mbr), min for this pool - for the first time - which means actual stake amount will be reduced
        // by 'first time staker' fee to cover MBR (which goes to VALIDATOR contract account, not staker contract account!)
        // we pay the extra here so the final staked amount should be exactly 1000
        const stakeAmount1 = AlgoAmount.MicroAlgos(
            AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
        );
        const [stakedPoolKey, fees1] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            stakeAmount1,
            0n
        );
        // should match info from first staking pool
        expect(stakedPoolKey.id).toEqual(firstPoolKey.id);
        expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId);
        expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId);

        let poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.totalStakers).toEqual(1);
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)));

        expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n);

        let validatorGlobalState = await validatorMasterClient.appClient.getGlobalState();
        expect(validatorGlobalState.staked.value).toEqual(stakeAmount1.microAlgos - Number(stakerMbr));
        expect(validatorGlobalState.numStakers.value).toEqual(1);

        const poolBalance1 = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do();
        expect(poolBalance1.amount).toEqual(origStakePoolInfo.amount + stakeAmount1.microAlgos - Number(stakerMbr));

        // now try to remove partial amount - which should fail because it will take staked amount to < its 'minimum amount'
        const ourPoolClient = new StakingPoolClient(
            { sender: stakerAccount, resolveBy: 'id', id: stakedPoolKey.poolAppId },
            fixture.context.algod
        );
        await expect(removeStake(ourPoolClient, stakerAccount, AlgoAmount.Algos(200))).rejects.toThrowError();

        // verify pool stake didn't change!
        poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)));
        expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n);

        validatorGlobalState = await validatorMasterClient.appClient.getGlobalState();
        expect(validatorGlobalState.staked.value).toEqual(stakeAmount1.microAlgos - Number(stakerMbr));
        expect(validatorGlobalState.numStakers.value).toEqual(1);

        // stake again for 1000 more - should go to same pool (!)
        const stakeAmount2 = AlgoAmount.Algos(1000);
        const [stakedKey2, fees2] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            stakeAmount2,
            0n
        );
        // should be same as what we added prior
        expect(stakedKey2.id).toEqual(firstPoolKey.id);
        expect(stakedKey2.poolId).toEqual(firstPoolKey.poolId);
        expect(stakedKey2.poolAppId).toEqual(firstPoolKey.poolAppId);
        // verify pool state changed...
        poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.totalAlgoStaked).toEqual(
            BigInt(stakeAmount1.microAlgos - Number(stakerMbr) + stakeAmount2.microAlgos)
        );
        // and global state changed
        validatorGlobalState = await validatorMasterClient.appClient.getGlobalState();
        expect(validatorGlobalState.staked.value).toEqual(
            stakeAmount1.microAlgos - Number(stakerMbr) + stakeAmount2.microAlgos
        );

        // ....and verify data for the 'staker' is correct as well
        const stakerInfo = await getStakerInfo(ourPoolClient, stakerAccount);
        expect(encodeAddress(stakerInfo.staker.publicKey)).toEqual(stakerAccount.addr);
        // should be full 2000 algos (we included extra for mbr to begin with)
        expect(stakerInfo.balance).toEqual(BigInt(AlgoAmount.Algos(2000).microAlgos));

        expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n);

        // let's also get list of all staked pools we're part of... should only contain 1 entry and just be our pool
        const allPools = await getStakedPoolsForAccount(validatorMasterClient, stakerAccount);
        expect(allPools).toHaveLength(1);
        expect(allPools[0]).toEqual(firstPoolKey);

        // second balance check of pool - it should increase by full stake amount since existing staker staked again, so no additional
        // mbr was needed
        const poolBalance2 = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do();
        expect(poolBalance2.amount).toEqual(poolBalance1.amount + stakeAmount2.microAlgos);

        const stakerAcctBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do();
        expect(stakerAcctBalance.amount).toEqual(
            AlgoAmount.Algos(5000).microAlgos - // funded amount
                stakeAmount1.microAlgos -
                stakeAmount2.microAlgos -
                fees1.microAlgos -
                fees2.microAlgos
        );

        // Verify 'total' staked from validator contract
        const stateData = await getValidatorState(validatorMasterClient, validatorId);
        expect(stateData.numPools).toEqual(1);
        expect(stateData.totalAlgoStaked).toEqual(
            BigInt(stakeAmount1.microAlgos + stakeAmount2.microAlgos - Number(stakerMbr))
        );
        expect(stateData.totalStakers).toEqual(1n);
        // and. globally
        validatorGlobalState = await validatorMasterClient.appClient.getGlobalState();
        expect(validatorGlobalState.staked.value).toEqual(
            stakeAmount1.microAlgos + stakeAmount2.microAlgos - Number(stakerMbr)
        );
    });

    // Creates new staker account
    // Adds 2000 algo to pool (not caring about mbr - so actual amount will be less the stakermbr amount)
    test('nextStaker', async () => {
        // get current balance of staker pool
        const origStakePoolInfo = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do();
        // and of all pools
        const origValidatorState = await getValidatorState(validatorMasterClient, validatorId);

        // Fund a 'staker account' that will be the new 'staker'
        const stakerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(5000), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        // add 2000 stake by random staker - should go to NEW slot - but this is still their first add, so they have to pay more mbr
        // this time - since it's over minimum... don't pay 'extra' - so we should ensure that the MBR is NOT part of what we stake
        const stakeAmount1 = AlgoAmount.Algos(2000);
        const [stakedPoolKey, fees] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            stakeAmount1,
            0n
        );
        // should be same as what we added prior
        expect(stakedPoolKey.id).toEqual(firstPoolKey.id);
        expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId);
        expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId);

        const poolBalance1 = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do();
        expect(poolBalance1.amount).toEqual(origStakePoolInfo.amount + stakeAmount1.microAlgos - Number(stakerMbr));

        const stakerAcctBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do();
        expect(stakerAcctBalance.amount).toEqual(
            AlgoAmount.Algos(5000).microAlgos - // funded amount
                stakeAmount1.microAlgos -
                fees.microAlgos
        );

        // let's also get list of all staked pools we're part of... should only contain 1 entry and just be our pool
        const allPools = await getStakedPoolsForAccount(validatorMasterClient, stakerAccount);
        expect(allPools).toHaveLength(1);
        expect(allPools[0]).toEqual(firstPoolKey);

        // Verify 'total' staked from validator contract
        const stateData = await getValidatorState(validatorMasterClient, validatorId);
        expect(stateData.numPools).toEqual(1);
        expect(stateData.totalAlgoStaked).toEqual(
            origValidatorState.totalAlgoStaked + BigInt(stakeAmount1.microAlgos - Number(stakerMbr))
        );
        expect(stateData.totalStakers).toEqual(BigInt(2));
    });

    test('validatorPoolCheck', async () => {
        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.poolAppId).toEqual(BigInt(poolAppId));
        expect(poolInfo.totalStakers).toEqual(2);
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(AlgoAmount.Algos(4000).microAlgos - Number(stakerMbr)));
    });

    test('addMaxPoolsAndFill', async () => {
        const pools: ValidatorPoolKey[] = [];
        const stakers: Account[] = [];
        const poolsToCreate = MaxPoolsPerNode;

        // capture current 'total' state for all pools
        const origValidatorState = await getValidatorState(validatorMasterClient, validatorId);

        // we create 'max pools per node' new pools on new node (first pool is still there which wee added as part of beforeAll)
        for (let i = 0; i < poolsToCreate; i += 1) {
            const newPool = await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                2, // add to different node - otherwise we'll fail
                validatorOwnerAccount,
                poolMbr,
                poolInitMbr
            );
            expect(newPool.poolId).toEqual(BigInt(2 + i));
            pools.push(newPool);
        }

        for (let i = 0; i < poolsToCreate; i += 1) {
            const poolInfo = await getPoolInfo(validatorMasterClient, pools[i]);
            expect(poolInfo.poolAppId).toEqual(pools[i].poolAppId);
            expect(poolInfo.totalStakers).toEqual(0);
            expect(poolInfo.totalAlgoStaked).toEqual(0n);
        }

        // now create X new stakers
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
        // have the first max-1 of the max new stakers - add such that each pool is basically completely full but just
        // short, so we can still add a small amount later in a test.
        // add stake for each - each time should work and go to new pool (starting with first pool we added - the one
        // that's already there shouldn't have room).  Then next add of same size should fail. then next add of something
        // small should go to first pool again
        const stakeAmount = AlgoAmount.MicroAlgos(MaxAlgoPerPool - AlgoAmount.Algos(1000).microAlgos);
        for (let i = 0; i < poolsToCreate - 1; i += 1) {
            const [stakedPoolKey] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakers[i],
                stakeAmount,
                0n
            );
            // should go to each pool in succession since it's basically the entire pool
            expect(stakedPoolKey.id).toEqual(pools[i].id);
            expect(stakedPoolKey.poolId).toEqual(pools[i].poolId);
            expect(stakedPoolKey.poolAppId).toEqual(pools[i].poolAppId);

            expect(await getStakedPoolsForAccount(validatorMasterClient, stakers[i])).toEqual([stakedPoolKey]);
        }
        // now try to add larger stake from staker max-1... should fail... nothing free
        await expect(
            addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakers[MaxPoolsPerNode - 1],
                AlgoAmount.MicroAlgos(MaxAlgoPerPool + AlgoAmount.Algos(1000).microAlgos),
                0n
            )
        ).rejects.toThrowError();

        // For last staker - get their staked pool list - should be empty
        expect(await getStakedPoolsForAccount(validatorMasterClient, stakers[MaxPoolsPerNode - 1])).toHaveLength(0);
        // have stakermaxPools-1 stake large amount - just barely under max - so should only fit in last pool
        const [fitTestStake1] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakers[MaxPoolsPerNode - 1],
            AlgoAmount.MicroAlgos(MaxAlgoPerPool - AlgoAmount.Algos(1000).microAlgos),
            0n
        );
        expect(fitTestStake1.id).toEqual(pools[MaxPoolsPerNode - 1].id);
        expect(fitTestStake1.poolId).toEqual(pools[MaxPoolsPerNode - 1].poolId);
        expect(fitTestStake1.poolAppId).toEqual(pools[MaxPoolsPerNode - 1].poolAppId);

        // Now have staker maxPools-1 stake 1000 - it'll fit in last pool (just) since it first tries pools staker is already in
        const [fitTestStake2] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakers[MaxPoolsPerNode - 1],
            AlgoAmount.Algos(1000),
            0n
        );
        expect(fitTestStake2.id).toEqual(pools[MaxPoolsPerNode - 1].id);
        expect(fitTestStake2.poolId).toEqual(pools[MaxPoolsPerNode - 1].poolId);
        expect(fitTestStake2.poolAppId).toEqual(pools[MaxPoolsPerNode - 1].poolAppId);

        // now try to add smallish stake from staker maxPools-1... should go to very first pool
        // # of stakers shouldn't increase!  They're new entrant into pool but already staked somewhere else !
        const [fitTestStake3] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakers[MaxPoolsPerNode - 1],
            AlgoAmount.Algos(1000),
            0n
        );
        expect(fitTestStake3.id).toEqual(firstPoolKey.id);
        expect(fitTestStake3.poolId).toEqual(firstPoolKey.poolId);
        expect(fitTestStake3.poolAppId).toEqual(firstPoolKey.poolAppId);

        // For staker maxPools-1 - get their staked pool list - should now be two entries - pool maxPools+1 (pool #maxpools we added) then pool 1 (order of staking)
        const lastStakerPools = await getStakedPoolsForAccount(validatorMasterClient, stakers[MaxPoolsPerNode - 1]);
        expect(lastStakerPools).toHaveLength(2);
        expect(lastStakerPools[0]).toEqual(pools[MaxPoolsPerNode - 1]);
        expect(lastStakerPools[1]).toEqual(firstPoolKey);

        // Get 'total' staked from validator contract
        const stateData = await getValidatorState(validatorMasterClient, validatorId);
        consoleLogger.info(
            `num pools: ${stateData.numPools}, total staked:${stateData.totalAlgoStaked}, stakers:${stateData.totalStakers}`
        );
        expect(stateData.numPools).toEqual(MaxPoolsPerNode + 1);
        expect(stateData.totalAlgoStaked).toEqual(
            origValidatorState.totalAlgoStaked +
                BigInt(stakeAmount.microAlgos * MaxPoolsPerNode) -
                BigInt(stakerMbr * BigInt(MaxPoolsPerNode)) +
                BigInt(AlgoAmount.Algos(2000).microAlgos)
        );
        expect(stateData.totalStakers).toEqual(BigInt(MaxPoolsPerNode + 2));
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
        const [addStake1, fees1] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            AlgoAmount.Algos(1100),
            0n
        );
        amountStaked += AlgoAmount.Algos(1100).microAlgos;
        expect(addStake1.id).toEqual(firstPoolKey.id);
        expect(addStake1.poolId).toEqual(firstPoolKey.poolId);
        expect(addStake1.poolAppId).toEqual(firstPoolKey.poolAppId);

        // add again. should go to same place
        const [addStake2, fees2] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            AlgoAmount.Algos(2000),
            0n
        );
        amountStaked += AlgoAmount.Algos(2000).microAlgos;

        expect(addStake2.id).toEqual(firstPoolKey.id);
        expect(addStake2.poolId).toEqual(firstPoolKey.poolId);
        expect(addStake2.poolAppId).toEqual(firstPoolKey.poolAppId);

        const stakerAcctBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do();
        expect(stakerAcctBalance.amount).toEqual(
            AlgoAmount.Algos(10_000).microAlgos - // funded amount
                amountStaked -
                fees1.microAlgos -
                fees2.microAlgos
        );

        // Verify the staked data matches....
        const allPools = await getStakedPoolsForAccount(validatorMasterClient, stakerAccount);
        expect(allPools).toHaveLength(1);
        expect(allPools[0]).toEqual(firstPoolKey);
        // ....and verify data for the 'staker' is correct as well
        const ourPoolClient = new StakingPoolClient(
            { sender: stakerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod
        );
        // The amount 'actually' staked won't include the MBR amount
        const stakerInfo = await getStakerInfo(ourPoolClient, stakerAccount);
        expect(encodeAddress(stakerInfo.staker.publicKey)).toEqual(stakerAccount.addr);
        expect(stakerInfo.balance).toEqual(BigInt(amountStaked - Number(stakerMbr)));

        // Get Pool info before removing stake..
        const preRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);

        // then remove the stake !
        const removeFees = await removeStake(
            ourPoolClient,
            stakerAccount,
            AlgoAmount.MicroAlgos(Number(stakerInfo.balance))
        );
        const newBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do();
        expect(newBalance.amount).toEqual(
            stakerAcctBalance.amount + Number(stakerInfo.balance) - removeFees // microAlgo for `removeStake fees
        );

        // stakers should have been reduced and stake amount should have been reduced by stake removed
        const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(postRemovePoolInfo.totalStakers).toEqual(preRemovePoolInfo.totalStakers - 1);
        expect(postRemovePoolInfo.totalAlgoStaked).toEqual(preRemovePoolInfo.totalAlgoStaked - stakerInfo.balance);
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
        const [addStake1, addFees] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            AlgoAmount.Algos(1100),
            0n
        );
        amountStaked += AlgoAmount.Algos(1100).microAlgos;
        expect(addStake1.id).toEqual(firstPoolKey.id);
        expect(addStake1.poolId).toEqual(firstPoolKey.poolId);
        expect(addStake1.poolAppId).toEqual(firstPoolKey.poolAppId);

        const stakerAcctBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do();
        expect(stakerAcctBalance.amount).toEqual(
            AlgoAmount.Algos(10_000).microAlgos - // funded amount
                amountStaked -
                addFees.microAlgos
        );

        // Verify the staked data matches....
        const allPools = await getStakedPoolsForAccount(validatorMasterClient, stakerAccount);
        expect(allPools).toHaveLength(1);
        expect(allPools[0]).toEqual(firstPoolKey);
        // ....and verify data for the 'staker' is correct as well
        const ourPoolClient = new StakingPoolClient(
            { sender: stakerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod
        );
        // The amount 'actually' staked won't include the MBR amount
        const stakerInfo = await getStakerInfo(ourPoolClient, stakerAccount);
        expect(encodeAddress(stakerInfo.staker.publicKey)).toEqual(stakerAccount.addr);
        expect(stakerInfo.balance).toEqual(BigInt(amountStaked - Number(stakerMbr)));

        // Get Pool info before removing stake..
        const preRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);

        // then remove ALL the stake  (specifying 0 to remove all)
        const removeFees = await removeStake(ourPoolClient, stakerAccount, AlgoAmount.MicroAlgos(0));
        const newBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do();
        expect(newBalance.amount).toEqual(
            stakerAcctBalance.amount + Number(stakerInfo.balance) - removeFees // microAlgo for removeStake fees
        );

        // stakers should have been reduced and stake amount should have been reduced by stake removed
        const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(postRemovePoolInfo.totalStakers).toEqual(preRemovePoolInfo.totalStakers - 1);
        expect(postRemovePoolInfo.totalAlgoStaked).toEqual(preRemovePoolInfo.totalAlgoStaked - stakerInfo.balance);
    });

    test('getStakeInfo', async () => {
        await logStakingPoolInfo(fixture.context, firstPoolKey.poolAppId, 'getStakeInfo');
    });
});

describe('StakeWRewards', () => {
    beforeEach(fixture.beforeEach);
    beforeEach(logs.beforeEach);
    afterEach(logs.afterEach);

    let validatorId: number;
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
        validatorId = await addValidator(
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
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr
        );
        // should be [validator id, pool id (1 based)]
        expect(firstPoolKey.id).toEqual(BigInt(validatorId));
        expect(firstPoolKey.poolId).toEqual(1n);

        firstPoolClient = new StakingPoolClient(
            { sender: validatorOwnerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod
        );

        // get the app id via contract call - it should match what we just got back in poolKey[2]
        poolAppId = (
            await validatorMasterClient.getPoolAppId(
                { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                { sendParams: { populateAppCallResources: true } }
            )
        ).return!;
        expect(firstPoolKey.poolAppId).toEqual(poolAppId);

        const stateData = await getValidatorState(validatorMasterClient, validatorId);
        expect(stateData.numPools).toEqual(1);
        expect(stateData.totalAlgoStaked).toEqual(0n);
        expect(stateData.totalStakers).toEqual(0n);

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.poolAppId).toEqual(BigInt(poolAppId));
        expect(poolInfo.totalStakers).toEqual(0);
        expect(poolInfo.totalAlgoStaked).toEqual(0n);
    });

    // Creates dummy staker:
    // adds 1000 algo (plus enough to cover staker mbr)
    test('firstStaker', async () => {
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
        const [stakedPoolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            stakeAmount1,
            0n
        );
        // should match info from first staking pool
        expect(stakedPoolKey.id).toEqual(firstPoolKey.id);
        expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId);
        expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId);

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.totalStakers).toEqual(1);
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)));

        expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n);
    });

    test('testFirstRewards', async () => {
        // increment time a day(+) at a time per transaction
        await fixture.context.algod.setBlockOffsetTimestamp(60 * 61 * 24).do();

        const origValidatorState = await getValidatorState(validatorMasterClient, validatorId);
        const ownerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do();
        const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient);

        const reward = AlgoAmount.Algos(200);
        // put some test 'reward' algos into staking pool
        await transferAlgos(
            {
                from: fixture.context.testAccount,
                to: getApplicationAddress(firstPoolKey.poolAppId),
                amount: reward,
            },
            fixture.context.algod
        );

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        consoleLogger.info(`pool stakers:${poolInfo.totalStakers}, staked:${poolInfo.totalAlgoStaked}`);

        const payoutBefore = BigInt((await firstPoolClient.appClient.getGlobalState()).lastPayout.value as bigint);
        const epochBefore = BigInt((await firstPoolClient.appClient.getGlobalState()).epochNumber.value as bigint);

        // Perform epoch payout calculation  - we also get back how much it cost to issue the txn
        const fees = await epochBalanceUpdate(firstPoolClient);
        const expectedValidatorReward = reward.microAlgos * (PctToValidator / 100);

        expect(BigInt((await firstPoolClient.appClient.getGlobalState()).lastPayout.value as bigint)).toBeGreaterThan(
            payoutBefore
        );
        expect(BigInt((await firstPoolClient.appClient.getGlobalState()).epochNumber.value as bigint)).toEqual(
            epochBefore + 1n
        );

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId);
        const newOwnerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do();
        // validator owner should have gotten the expected reward (minus the fees they just paid ofc)
        expect(newOwnerBalance.amount).toEqual(ownerBalance.amount - fees.microAlgos + expectedValidatorReward);

        // Verify all the stakers in the pool got what we think they should have
        const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient);

        await verifyRewardAmounts(
            fixture.context,
            (BigInt(reward.microAlgos) - BigInt(expectedValidatorReward)) as bigint,
            0n,
            stakersPriorToReward as StakedInfo[],
            stakersAfterReward as StakedInfo[],
            1 as number
        );

        // the total staked should have grown as well - reward minus what the validator was paid in their commission
        expect(Number(newValidatorState.totalAlgoStaked)).toEqual(
            Number(origValidatorState.totalAlgoStaked) + (reward.microAlgos - expectedValidatorReward)
        );

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey);
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked);
    });

    test('extractRewards', async () => {
        const origStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[0].addr).do();

        // Remove it all
        const fees = await removeStake(firstPoolClient, stakerAccounts[0], AlgoAmount.Algos(1190));

        const newStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[0].addr).do();
        // 1000 algos staked + 190 reward (- fees for removing stake)
        expect(newStakerBalance.amount).toEqual(origStakerBalance.amount + AlgoAmount.Algos(1190).microAlgos - fees);

        // no one should be left and be 0 balance
        const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(postRemovePoolInfo.totalStakers).toEqual(0);
        expect(postRemovePoolInfo.totalAlgoStaked).toEqual(0n);

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId);
        expect(Number(newValidatorState.totalAlgoStaked)).toEqual(0);
        expect(Number(newValidatorState.totalStakers)).toEqual(0);

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey);
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked);
    });

    test('testNotEnoughRewards', async () => {
        // Do epoch payout immediately with no new funds - should fail because not enough to pay out to validator, etc.
        const ownerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do();
        const epochBefore = BigInt((await firstPoolClient.appClient.getGlobalState()).epochNumber.value as bigint);
        const fees = await epochBalanceUpdate(firstPoolClient);

        expect(BigInt((await firstPoolClient.appClient.getGlobalState()).epochNumber.value as bigint)).toEqual(
            epochBefore + 1n
        );
        const newOwnerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do();
        expect(newOwnerBalance.amount).toEqual(ownerBalance.amount - fees.microAlgos);
    });

    test('testTooEarlyEpoch', async () => {
        // increment 1 hour at a time per transaction
        await fixture.context.algod.setBlockOffsetTimestamp(60 * 60).do();

        // put some test 'reward' algos into staking pool
        await transferAlgos(
            {
                from: fixture.context.testAccount,
                to: getApplicationAddress(firstPoolKey.poolAppId),
                amount: AlgoAmount.Algos(100),
            },
            fixture.context.algod
        );

        // this payout should work... between prior tests and just now - it's been a day.
        // validator will have received 5 algo (on the 100 we just put in the pool) - we account for that later...
        await epochBalanceUpdate(firstPoolClient);

        await transferAlgos(
            {
                from: fixture.context.testAccount,
                to: getApplicationAddress(firstPoolKey.poolAppId),
                amount: AlgoAmount.Algos(100),
            },
            fixture.context.algod
        );
        // We added more again - but enough time shouldn't have passed to allow another payout
        await expect(epochBalanceUpdate(firstPoolClient)).rejects.toThrowError();

        // and staked amount should still be 0
        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.totalStakers).toEqual(0);
        expect(poolInfo.totalAlgoStaked).toEqual(0n);

        await logStakingPoolInfo(fixture.context, firstPoolKey.poolAppId, 'should be no stakers !');

        // We added 200 algo in to bump the clock a bit - and cause transactions - this is basically future reward
        // we did 1 payout - so balance should be 200 - (validator % of 100)
        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey);
        expect(poolBalance).toEqual(
            BigInt(AlgoAmount.Algos(200).microAlgos) - BigInt(AlgoAmount.Algos(100).microAlgos * (PctToValidator / 100))
        );
        consoleLogger.info(`ending pool balance: ${poolBalance}`);
    });

    test('testPartialReward', async () => {
        // increment 1 hour at a time per transaction
        await fixture.context.algod.setBlockOffsetTimestamp(60 * 60).do();

        // loop until we get a payout (from prior 'too early' state)
        for (let i = 0; i < 24; i += 1) {
            try {
                await epochBalanceUpdate(firstPoolClient);
                break;
            } catch (exception) {
                // move the clock by issuing a txn.
                await transferAlgos(
                    {
                        from: fixture.context.testAccount,
                        to: getApplicationAddress(firstPoolKey.poolAppId),
                        amount: AlgoAmount.Algos(10),
                    },
                    fixture.context.algod
                );
            }
        }

        // double-check no one should be left and be 0 balance
        const checkPoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(checkPoolInfo.totalStakers).toEqual(0);
        expect(checkPoolInfo.totalAlgoStaked).toEqual(0n);

        const checkValidatorState = await getValidatorState(validatorMasterClient, validatorId);
        expect(Number(checkValidatorState.totalAlgoStaked)).toEqual(0);
        expect(Number(checkValidatorState.totalStakers)).toEqual(0);

        // Ok, re-enter the pool - but we'll be in right off the bat and be there for full epoch
        // now stake 1000(+mbr), min for this pool - for the first time - which means actual stake amount will be reduced
        // by 'first time staker' fee to cover MBR (which goes to VALIDATOR contract account, not staker contract account!)
        // we pay the extra here so the final staked amount should be exactly 1000
        const stakeAmount1 = AlgoAmount.Algos(1000);
        // Add stake for first staker - partial epoch
        const [aPoolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccounts[0],
            stakeAmount1,
            0n
        );
        expect(aPoolKey.poolAppId).toEqual(aPoolKey.poolAppId);

        const staker1Info = await getStakerInfo(firstPoolClient, stakerAccounts[0]);
        const entryTime = new Date(Number(staker1Info.entryTime) * 1000); // convert to ms
        const stakingPoolGS = await firstPoolClient.appClient.getGlobalState();
        const lastPayoutTime = new Date(Number(stakingPoolGS.lastPayout.value as bigint) * 1000);
        consoleLogger.info(`lastPayout:${lastPayoutTime.toString()}, new entry time: ${entryTime.toString()}`);

        // Ok - bump time so that the next staker will be towards tail end of next epoch payout
        await fixture.context.algod.setBlockOffsetTimestamp(60 * 60 * 24).do();

        // Add second (brand new!) staker - with same amount entered - but entering later (so it will be a 'partial'
        // entry into the epoch (so we can ensure partial payout occurs)
        const partialEpochStaker = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(5000), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        stakerAccounts.push(partialEpochStaker);
        const stakeAmount2 = AlgoAmount.MicroAlgos(
            AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
        );

        // Add stake for partial-epoch staker
        const [newPoolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            partialEpochStaker,
            stakeAmount2,
            0n
        );

        expect(newPoolKey.poolAppId).toEqual(aPoolKey.poolAppId);
        const staker2Info = await getStakerInfo(firstPoolClient, partialEpochStaker);
        const staker2Entry = new Date(Number(staker2Info.entryTime) * 1000);
        consoleLogger.info(`partialEpochStaker: new entry time: ${staker2Entry.toString()}`);

        await logStakingPoolInfo(fixture.context, firstPoolKey.poolAppId, 'should have two stakers');

        // ok now do payouts - and see if we can verify the expected totals
        const poolInfo = await getPoolInfo(validatorMasterClient, aPoolKey);
        expect(poolInfo.totalStakers).toEqual(2);
        // only subtract out 1 staker mbr because only the 'fullEpochStaker' will be 'new' to staking
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos + stakeAmount2.microAlgos) - stakerMbr);

        // What's pool's current balance
        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey);
        const knownReward = poolBalance - poolInfo.totalAlgoStaked;
        const expectedValidatorReward = Number(knownReward) * (PctToValidator / 100);

        const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient);

        // do reward calcs
        await epochBalanceUpdate(firstPoolClient);
        const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient);

        await logStakingPoolInfo(fixture.context, firstPoolKey.poolAppId, 'after payouts');
        await verifyRewardAmounts(
            fixture.context,
            knownReward - BigInt(expectedValidatorReward),
            0n,
            stakersPriorToReward,
            stakersAfterReward,
            1
        );
    });
});

describe('StakeW0Commission', () => {
    beforeEach(fixture.beforeEach);
    beforeEach(logs.beforeEach);
    afterEach(logs.afterEach);

    let validatorId: number;
    let validatorOwnerAccount: Account;
    const stakerAccounts: Account[] = [];
    let poolAppId: bigint;
    let firstPoolKey: ValidatorPoolKey;
    let firstPoolClient: StakingPoolClient;

    const PctToValidator = 0;

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
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr
        );
        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr
        );
        expect(firstPoolKey.id).toEqual(BigInt(validatorId));
        expect(firstPoolKey.poolId).toEqual(1n);

        firstPoolClient = new StakingPoolClient(
            { sender: validatorOwnerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod
        );
        poolAppId = (
            await validatorMasterClient.getPoolAppId(
                { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                { sendParams: { populateAppCallResources: true } }
            )
        ).return!;
        expect(firstPoolKey.poolAppId).toEqual(poolAppId);
    });

    // boilerplate at this point. just dd some stake - testing different commissions is all we care about
    test('firstStaker', async () => {
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
        const [stakedPoolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            stakeAmount1,
            0n
        );
        // should match info from first staking pool
        expect(stakedPoolKey.id).toEqual(firstPoolKey.id);
        expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId);
        expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId);

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.totalStakers).toEqual(1);
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)));

        expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n);
    });

    test('testFirstRewards', async () => {
        // increment time a day(+) at a time per transaction
        await fixture.context.algod.setBlockOffsetTimestamp(60 * 61 * 24).do();

        const origValidatorState = await getValidatorState(validatorMasterClient, validatorId);
        const ownerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do();
        const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient);

        const reward = AlgoAmount.Algos(200);
        // put some test 'reward' algos into staking pool
        await transferAlgos(
            {
                from: fixture.context.testAccount,
                to: getApplicationAddress(firstPoolKey.poolAppId),
                amount: reward,
            },
            fixture.context.algod
        );

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        consoleLogger.info(`pool stakers:${poolInfo.totalStakers}, staked:${poolInfo.totalAlgoStaked}`);

        const epochBefore = BigInt((await firstPoolClient.appClient.getGlobalState()).epochNumber.value as bigint);

        // Perform epoch payout calculation  - we also get back how much it cost to issue the txn
        const fees = await epochBalanceUpdate(firstPoolClient);
        const expectedValidatorReward = reward.microAlgos * (PctToValidator / 100);

        expect(BigInt((await firstPoolClient.appClient.getGlobalState()).epochNumber.value as bigint)).toEqual(
            epochBefore + 1n
        );

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId);
        const newOwnerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do();
        // validator owner should have gotten the expected reward (minus the fees they just paid ofc)
        expect(newOwnerBalance.amount).toEqual(ownerBalance.amount - fees.microAlgos + expectedValidatorReward);

        // Verify all the stakers in the pool got what we think they should have
        const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient);

        await verifyRewardAmounts(
            fixture.context,
            (BigInt(reward.microAlgos) - BigInt(expectedValidatorReward)) as bigint,
            0n,
            stakersPriorToReward as StakedInfo[],
            stakersAfterReward as StakedInfo[],
            1 as number
        );

        // the total staked should have grown as well - reward minus what the validator was paid in their commission
        expect(Number(newValidatorState.totalAlgoStaked)).toEqual(
            Number(origValidatorState.totalAlgoStaked) + (reward.microAlgos - expectedValidatorReward)
        );

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey);
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked);
    });

    test('extractRewards', async () => {
        const origStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[0].addr).do();

        const expectedBalance = AlgoAmount.Algos(1000 + 200 - 200 * (PctToValidator / 100));
        // Remove it all
        const fees = await removeStake(firstPoolClient, stakerAccounts[0], expectedBalance);

        const newStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[0].addr).do();
        // 1000 algos staked + 190 reward (- fees for removing stake)
        expect(newStakerBalance.amount).toEqual(origStakerBalance.amount + expectedBalance.microAlgos - fees);

        // no one should be left and be 0 balance
        const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(postRemovePoolInfo.totalStakers).toEqual(0);
        expect(postRemovePoolInfo.totalAlgoStaked).toEqual(0n);

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId);
        expect(Number(newValidatorState.totalAlgoStaked)).toEqual(0);
        expect(Number(newValidatorState.totalStakers)).toEqual(0);

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey);
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked);
    });
});

describe('StakeW100Commission', () => {
    beforeEach(fixture.beforeEach);
    beforeEach(logs.beforeEach);
    afterEach(logs.afterEach);

    let validatorId: number;
    let validatorOwnerAccount: Account;
    const stakerAccounts: Account[] = [];
    let poolAppId: bigint;
    let firstPoolKey: ValidatorPoolKey;
    let firstPoolClient: StakingPoolClient;

    const PctToValidator = 100;

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
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr
        );
        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr
        );
        expect(firstPoolKey.id).toEqual(BigInt(validatorId));
        expect(firstPoolKey.poolId).toEqual(1n);

        firstPoolClient = new StakingPoolClient(
            { sender: validatorOwnerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod
        );
        poolAppId = (
            await validatorMasterClient.getPoolAppId(
                { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                { sendParams: { populateAppCallResources: true } }
            )
        ).return!;
        expect(firstPoolKey.poolAppId).toEqual(poolAppId);
    });

    // boilerplate at this point. just dd some stake - testing different commissions is all we care about
    test('firstStaker', async () => {
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
        const [stakedPoolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            stakeAmount1,
            0n
        );
        // should match info from first staking pool
        expect(stakedPoolKey.id).toEqual(firstPoolKey.id);
        expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId);
        expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId);

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.totalStakers).toEqual(1);
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)));

        expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n);
    });

    test('testFirstRewards', async () => {
        // increment time a day(+) at a time per transaction
        await fixture.context.algod.setBlockOffsetTimestamp(60 * 61 * 24).do();

        const origValidatorState = await getValidatorState(validatorMasterClient, validatorId);
        const ownerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do();
        const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient);

        const reward = AlgoAmount.Algos(200);
        // put some test 'reward' algos into staking pool
        await transferAlgos(
            {
                from: fixture.context.testAccount,
                to: getApplicationAddress(firstPoolKey.poolAppId),
                amount: reward,
            },
            fixture.context.algod
        );

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        consoleLogger.info(`pool stakers:${poolInfo.totalStakers}, staked:${poolInfo.totalAlgoStaked}`);

        const epochBefore = BigInt((await firstPoolClient.appClient.getGlobalState()).epochNumber.value as bigint);

        // Perform epoch payout calculation  - we also get back how much it cost to issue the txn
        const fees = await epochBalanceUpdate(firstPoolClient);
        const expectedValidatorReward = reward.microAlgos * (PctToValidator / 100);

        expect(BigInt((await firstPoolClient.appClient.getGlobalState()).epochNumber.value as bigint)).toEqual(
            epochBefore + 1n
        );

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId);
        const newOwnerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do();
        // validator owner should have gotten the expected reward (minus the fees they just paid ofc)
        expect(newOwnerBalance.amount).toEqual(ownerBalance.amount - fees.microAlgos + expectedValidatorReward);

        // Verify all the stakers in the pool got what we think they should have
        const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient);

        await verifyRewardAmounts(
            fixture.context,
            (BigInt(reward.microAlgos) - BigInt(expectedValidatorReward)) as bigint,
            0n,
            stakersPriorToReward as StakedInfo[],
            stakersAfterReward as StakedInfo[],
            1 as number
        );

        // the total staked should have grown as well - reward minus what the validator was paid in their commission
        expect(Number(newValidatorState.totalAlgoStaked)).toEqual(
            Number(origValidatorState.totalAlgoStaked) + (reward.microAlgos - expectedValidatorReward)
        );

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey);
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked);
    });

    test('extractRewards', async () => {
        const origStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[0].addr).do();

        const expectedBalance = AlgoAmount.Algos(1000 + 200 - 200 * (PctToValidator / 100));
        // Remove it all
        const fees = await removeStake(firstPoolClient, stakerAccounts[0], expectedBalance);

        const newStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[0].addr).do();
        // 1000 algos staked + 190 reward (- fees for removing stake)
        expect(newStakerBalance.amount).toEqual(origStakerBalance.amount + expectedBalance.microAlgos - fees);

        // no one should be left and be 0 balance
        const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(postRemovePoolInfo.totalStakers).toEqual(0);
        expect(postRemovePoolInfo.totalAlgoStaked).toEqual(0n);

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId);
        expect(Number(newValidatorState.totalAlgoStaked)).toEqual(0);
        expect(Number(newValidatorState.totalStakers)).toEqual(0);

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey);
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked);
    });
});

describe('StakeWTokenWRewards', () => {
    beforeEach(fixture.beforeEach);
    beforeEach(logs.beforeEach);
    afterEach(logs.afterEach);

    let validatorId: number;
    let validatorOwnerAccount: Account;
    let validatorConfig: ValidatorConfig;
    const stakerAccounts: Account[] = [];
    let poolAppId: bigint;
    let firstPoolKey: ValidatorPoolKey;
    let firstPoolClient: StakingPoolClient;

    let rewardTokenID: bigint;
    const PctToValidator = 5;
    const decimals = 0;
    const tokenRewardPerPayout = BigInt(1000 * 10 ** decimals);

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        // Create a reward token to pay out to stakers
        const tokenCreatorAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(5000), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        rewardTokenID = await createAsset(
            fixture.context.algod,
            tokenCreatorAccount,
            'Reward Token',
            'RWDTOKEN',
            100_000,
            decimals
        );

        // Fund a 'validator account' that will be the validator owner.
        validatorOwnerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(500), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`);

        validatorConfig = createValidatorConfig({
            Owner: validatorOwnerAccount.addr,
            Manager: validatorOwnerAccount.addr,
            MinEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            MaxAlgoPerPool: BigInt(MaxAlgoPerPool), // this comes into play in later tests !!
            PercentToValidator: PctToValidator * 10000,
            ValidatorCommissionAddress: validatorOwnerAccount.addr,
            RewardTokenID: rewardTokenID,
            RewardPerPayout: tokenRewardPerPayout, // 1000 tokens per epoch
        });
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            validatorConfig,
            validatorMbr
        );

        // Add new pool - then we'll add stake and verify balances.
        // first pool needs extra .1 to cover MBR of opted-in reward token !
        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr + BigInt(AlgoAmount.Algos(0.1).microAlgos)
        );
        // should be [validator id, pool id (1 based)]
        expect(firstPoolKey.id).toEqual(BigInt(validatorId));
        expect(firstPoolKey.poolId).toEqual(1n);

        // now send a bunch of our reward token to the pool !
        await transferAsset(
            {
                from: tokenCreatorAccount,
                to: getApplicationAddress(firstPoolKey.poolAppId),
                assetId: Number(rewardTokenID),
                amount: 5000 * 10 ** decimals,
            },
            fixture.context.algod
        );

        firstPoolClient = new StakingPoolClient(
            { sender: validatorOwnerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod
        );

        // get the app id via contract call - it should match what we just got back in the poolKey
        poolAppId = (
            await validatorMasterClient.getPoolAppId(
                { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                { sendParams: { populateAppCallResources: true } }
            )
        ).return!;
        expect(firstPoolKey.poolAppId).toEqual(poolAppId);

        const stateData = await getValidatorState(validatorMasterClient, validatorId);
        expect(stateData.numPools).toEqual(1);
        expect(stateData.totalAlgoStaked).toEqual(0n);
        expect(stateData.totalStakers).toEqual(0n);
        expect(stateData.rewardTokenHeldBack).toEqual(0n);

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.poolAppId).toEqual(BigInt(poolAppId));
        expect(poolInfo.totalStakers).toEqual(0);
        expect(poolInfo.totalAlgoStaked).toEqual(0n);
    });

    // Creates dummy staker:
    // adds 1000 algo (plus enough to cover staker mbr)
    test('firstStaker', async () => {
        // Fund a 'staker account' that will be the new 'staker'
        const stakerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(5000), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        stakerAccounts.push(stakerAccount);
        // opt-in to reward token
        await assetOptIn({ account: stakerAccount, assetId: Number(rewardTokenID) }, fixture.context.algod);

        // now stake 1000(+mbr), min for this pool - for the first time - which means actual stake amount will be reduced
        // by 'first time staker' fee to cover MBR (which goes to VALIDATOR contract account, not staker contract account!)
        // we pay the extra here so the final staked amount should be exactly 1000
        const stakeAmount1 = AlgoAmount.MicroAlgos(
            AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
        );
        const [stakedPoolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            stakeAmount1,
            0n
        );
        // should match info from first staking pool
        expect(stakedPoolKey.id).toEqual(firstPoolKey.id);
        expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId);
        expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId);

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.totalStakers).toEqual(1);
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)));

        expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n);
    });

    test('testFirstRewards', async () => {
        // increment time a day(+) at a time per transaction
        await fixture.context.algod.setBlockOffsetTimestamp(60 * 60 * 25).do();

        const origValidatorState = await getValidatorState(validatorMasterClient, validatorId);
        const ownerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do();
        const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient);

        const reward = AlgoAmount.Algos(200);

        // put some test 'reward' algos into staking pool - reward tokens are already there
        await transferAlgos(
            {
                from: fixture.context.testAccount,
                to: getApplicationAddress(firstPoolKey.poolAppId),
                amount: reward,
            },
            fixture.context.algod
        );

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        consoleLogger.info(`pool stakers:${poolInfo.totalStakers}, staked:${poolInfo.totalAlgoStaked}`);

        // Perform epoch payout calculation  - we also get back how much it cost to issue the txn
        const fees = await epochBalanceUpdate(firstPoolClient);
        const expectedValidatorReward = reward.microAlgos * (PctToValidator / 100);

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId);
        const newOwnerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do();
        // validator owner should have gotten the expected reward (minus the fees they just paid ofc)
        expect(newOwnerBalance.amount).toEqual(ownerBalance.amount - fees.microAlgos + expectedValidatorReward);

        // Verify all the stakers in the pool got what we think they should have
        const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient);

        await verifyRewardAmounts(
            fixture.context,
            (BigInt(reward.microAlgos) - BigInt(expectedValidatorReward)) as bigint,
            BigInt(tokenRewardPerPayout),
            stakersPriorToReward as StakedInfo[],
            stakersAfterReward as StakedInfo[],
            1 as number
        );

        // the total staked should have grown as well - reward minus what the validator was paid in their commission
        expect(Number(newValidatorState.totalAlgoStaked)).toEqual(
            Number(origValidatorState.totalAlgoStaked) + (reward.microAlgos - expectedValidatorReward)
        );
        // await logStakingPoolInfo(fixture.context, firstPoolKey.poolAppId, 'tokenRewardCheck');

        // the reward tokens 'held' back should've grown by the token payout amount
        expect(newValidatorState.rewardTokenHeldBack).toEqual(BigInt(validatorConfig.RewardPerPayout));

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey);
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked);
    });

    test('extractRewards', async () => {
        const origStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[0].addr).do();

        // Remove it all
        const removeFees = await removeStake(firstPoolClient, stakerAccounts[0], AlgoAmount.Algos(1190));

        const newStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[0].addr).do();
        // 1000 algos staked + 190 reward (- .004 in fees for removing stake)
        expect(newStakerBalance.amount).toEqual(
            origStakerBalance.amount + AlgoAmount.Algos(1190).microAlgos - removeFees
        );
        // verify that reward token payout came to us
        const assetInfo = await fixture.context.algod
            .accountAssetInformation(stakerAccounts[0].addr, Number(rewardTokenID))
            .do();
        expect(BigInt(assetInfo['asset-holding'].amount)).toEqual(tokenRewardPerPayout);

        // no one should be left and be 0 balance
        const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(postRemovePoolInfo.totalStakers).toEqual(0);
        expect(postRemovePoolInfo.totalAlgoStaked).toEqual(0n);

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId);
        expect(Number(newValidatorState.totalAlgoStaked)).toEqual(0);
        expect(Number(newValidatorState.totalStakers)).toEqual(0);
        expect(newValidatorState.rewardTokenHeldBack).toEqual(0n);

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey);
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked);
    });

    test('testPartialReward', async () => {
        // increment 1 hour at a time per transaction
        await fixture.context.algod.setBlockOffsetTimestamp(60 * 60).do();

        // loop until we get a payout (from prior 'too early' state)
        for (let i = 0; i < 24; i += 1) {
            try {
                await epochBalanceUpdate(firstPoolClient);
                break;
            } catch (exception) {
                // move the clock by issuing a txn.
                await transferAlgos(
                    {
                        from: fixture.context.testAccount,
                        to: getApplicationAddress(firstPoolKey.poolAppId),
                        amount: AlgoAmount.Algos(10),
                    },
                    fixture.context.algod
                );
            }
        }

        // double-check no one should be left and be 0 balance
        const checkPoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(checkPoolInfo.totalStakers).toEqual(0);
        expect(checkPoolInfo.totalAlgoStaked).toEqual(0n);

        const checkValidatorState = await getValidatorState(validatorMasterClient, validatorId);
        expect(Number(checkValidatorState.totalAlgoStaked)).toEqual(0);
        expect(Number(checkValidatorState.totalStakers)).toEqual(0);

        // Ok, re-enter the pool - but we'll be in right off the bat and be there for full epoch
        // now stake 1000(+mbr), min for this pool - for the first time - which means actual stake amount will be reduced
        // by 'first time staker' fee to cover MBR (which goes to VALIDATOR contract account, not staker contract account!)
        // we pay the extra here so the final staked amount should be exactly 1000
        const stakeAmount1 = AlgoAmount.Algos(1000);
        // Add stake for first staker - partial epoch
        const [aPoolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccounts[0],
            stakeAmount1,
            0n
        );
        expect(aPoolKey.poolAppId).toEqual(aPoolKey.poolAppId);

        const staker1Info = await getStakerInfo(firstPoolClient, stakerAccounts[0]);
        const entryTime = new Date(Number(staker1Info.entryTime) * 1000); // convert to ms
        const stakingPoolGS = await firstPoolClient.appClient.getGlobalState();
        const lastPayoutTime = new Date(Number(stakingPoolGS.lastPayout.value as bigint) * 1000);
        consoleLogger.info(`lastPayout:${lastPayoutTime.toString()}, new entry time: ${entryTime.toString()}`);

        // Ok - bump time so that the next staker will be towards tail end of next epoch payout
        await fixture.context.algod.setBlockOffsetTimestamp(60 * 60 * 24).do();

        // Add second (brand new!) staker - with same amount entered - but entering later (so it will be a 'partial'
        // entry into the epoch (so we can ensure partial payout occurs)
        const partialEpochStaker = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(5000), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        stakerAccounts.push(partialEpochStaker);
        // opt-in to reward token
        await assetOptIn({ account: partialEpochStaker, assetId: Number(rewardTokenID) }, fixture.context.algod);

        const stakeAmount2 = AlgoAmount.MicroAlgos(
            AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
        );

        // Add stake for partial-epoch staker
        const [newPoolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            partialEpochStaker,
            stakeAmount2,
            0n
        );

        expect(newPoolKey.poolAppId).toEqual(aPoolKey.poolAppId);
        const staker2Info = await getStakerInfo(firstPoolClient, partialEpochStaker);
        const staker2Entry = new Date(Number(staker2Info.entryTime) * 1000);
        consoleLogger.info(`partialEpochStaker: new entry time: ${staker2Entry.toString()}`);

        await logStakingPoolInfo(fixture.context, firstPoolKey.poolAppId, 'should have two stakers');

        // ok now do payouts - and see if we can verify the expected totals
        const poolInfo = await getPoolInfo(validatorMasterClient, aPoolKey);
        expect(poolInfo.totalStakers).toEqual(2);
        // only subtract out 1 staker mbr because only the 'fullEpochStaker' will be 'new' to staking
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos + stakeAmount2.microAlgos) - stakerMbr);

        // What's pool's current balance
        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey);
        const knownReward = poolBalance - poolInfo.totalAlgoStaked;
        const expectedValidatorReward = Number(knownReward) * (PctToValidator / 100);

        const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient);

        // do reward calcs
        await epochBalanceUpdate(firstPoolClient);
        const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient);

        await logStakingPoolInfo(fixture.context, firstPoolKey.poolAppId, 'after payouts');
        await verifyRewardAmounts(
            fixture.context,
            knownReward - BigInt(expectedValidatorReward),
            BigInt(tokenRewardPerPayout),
            stakersPriorToReward,
            stakersAfterReward,
            1
        );
    });
});

describe('TokenRewardOnlyTokens', () => {
    beforeEach(fixture.beforeEach);
    beforeEach(logs.beforeEach);
    afterEach(logs.afterEach);

    let validatorId: number;
    let validatorOwnerAccount: Account;
    let validatorConfig: ValidatorConfig;
    let firstPoolKey: ValidatorPoolKey;
    let firstPoolClient: StakingPoolClient;
    let stakerAccount: Account;

    let rewardTokenID: bigint;
    const tokenRewardPerPayout = 1000n;

    beforeAll(async () => {
        // Create a reward token to pay out to stakers
        const tokenCreatorAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(5000), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        rewardTokenID = await createAsset(
            fixture.context.algod,
            tokenCreatorAccount,
            'Reward Token',
            'RWDTOKEN',
            100_000,
            0
        );

        validatorOwnerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(500), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`);

        validatorConfig = createValidatorConfig({
            Owner: validatorOwnerAccount.addr,
            Manager: validatorOwnerAccount.addr,
            MinEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            MaxAlgoPerPool: BigInt(MaxAlgoPerPool), // this comes into play in later tests !!
            PercentToValidator: 5 * 10000,
            ValidatorCommissionAddress: validatorOwnerAccount.addr,
            RewardTokenID: rewardTokenID,
            RewardPerPayout: tokenRewardPerPayout, // 1000 tokens per epoch
        });
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            validatorConfig,
            validatorMbr
        );

        // Add new pool - then we'll add stake and verify balances.
        // first pool needs extra .1 to cover MBR of opted-in reward token !
        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr + BigInt(AlgoAmount.Algos(0.1).microAlgos)
        );
        // should be [validator id, pool id (1 based)]
        expect(firstPoolKey.id).toEqual(BigInt(validatorId));
        expect(firstPoolKey.poolId).toEqual(1n);

        await transferAsset(
            {
                from: tokenCreatorAccount,
                to: getApplicationAddress(firstPoolKey.poolAppId),
                assetId: Number(rewardTokenID),
                amount: 5000,
            },
            fixture.context.algod
        );

        firstPoolClient = new StakingPoolClient(
            { sender: validatorOwnerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod
        );
    });

    // Creates dummy staker:
    // adds 1000 algo (plus enough to cover staker mbr)
    test('firstStaker', async () => {
        // Fund a 'staker account' that will be the new 'staker'
        stakerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(5000), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        // opt-in to reward token
        await assetOptIn({ account: stakerAccount, assetId: Number(rewardTokenID) }, fixture.context.algod);

        // now stake 1000(+mbr), min for this pool - for the first time - which means actual stake amount will be reduced
        // by 'first time staker' fee to cover MBR (which goes to VALIDATOR contract account, not staker contract account!)
        // we pay the extra here so the final staked amount should be exactly 1000
        const stakeAmount1 = AlgoAmount.MicroAlgos(
            AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
        );
        await addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmount1, 0n);
        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)));
        expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n);
    });

    test('testFirstRewards', async () => {
        // increment time a day at a time per transaction
        await fixture.context.algod.setBlockOffsetTimestamp(60 * 60 * 25).do();

        const origValidatorState = await getValidatorState(validatorMasterClient, validatorId);
        const ownerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do();
        const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient);

        // Perform epoch payout calculation - should be 0 algo reward (!)
        // we should just do token payout
        const fees = await epochBalanceUpdate(firstPoolClient);

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId);
        const newOwnerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do();
        // validator owner balance shouldn't have changed (other than fees to call epoch update)
        expect(newOwnerBalance.amount).toEqual(ownerBalance.amount - fees.microAlgos);

        // Verify all the stakers in the pool got what we think they should have
        const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient);

        await verifyRewardAmounts(
            fixture.context,
            0n, // 0 algo reward
            BigInt(tokenRewardPerPayout),
            stakersPriorToReward as StakedInfo[],
            stakersAfterReward as StakedInfo[],
            1 as number
        );

        // the total staked should have grown as well - reward minus what the validator was paid in their commission
        expect(newValidatorState.totalAlgoStaked).toEqual(origValidatorState.totalAlgoStaked);

        // the reward tokens 'held' back should've grown by the token payout amount
        expect(newValidatorState.rewardTokenHeldBack).toEqual(BigInt(validatorConfig.RewardPerPayout));

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey);
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked);
    });

    test('extractRewards', async () => {
        const origStakerBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do();

        // Remove it all - but w/ claimTokens call instead of removeStake
        const removeFees = await claimTokens(firstPoolClient, stakerAccount);

        const newStakerBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do();
        // 1000 algos staked + 190 reward (- .004 in fees for removing stake)
        expect(newStakerBalance.amount).toEqual(origStakerBalance.amount - removeFees);
        // verify that reward token payout came to us
        const assetInfo = await fixture.context.algod
            .accountAssetInformation(stakerAccount.addr, Number(rewardTokenID))
            .do();
        expect(BigInt(assetInfo['asset-holding'].amount)).toEqual(tokenRewardPerPayout);

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId);
        // total staked should be same -staker shouldn't have gone away - token held back should've gone to 0
        expect(newValidatorState.totalAlgoStaked).toEqual(BigInt(AlgoAmount.Algos(1000).microAlgos));
        expect(newValidatorState.totalStakers).toEqual(1n);
        expect(newValidatorState.rewardTokenHeldBack).toEqual(0n);

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey);
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked);
    });
});

describe('DoublePoolWTokens', () => {
    beforeEach(fixture.beforeEach);
    beforeEach(logs.beforeEach);
    afterEach(logs.afterEach);

    let validatorId: number;
    let validatorOwnerAccount: Account;
    let validatorConfig: ValidatorConfig;
    const stakerAccounts: Account[] = [];
    let poolAppId: bigint;
    const poolKeys: ValidatorPoolKey[] = [];
    const poolClients: StakingPoolClient[] = [];

    let rewardTokenID: bigint;
    const PctToValidator = 5;
    const decimals = 0;
    const tokenRewardPerPayout = BigInt(1000 * 10 ** decimals);

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        // Create a reward token to pay out to stakers
        const tokenCreatorAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(5000), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        rewardTokenID = await createAsset(
            fixture.context.algod,
            tokenCreatorAccount,
            'Reward Token',
            'RWDTOKEN',
            100_000,
            decimals
        );

        // Fund a 'validator account' that will be the validator owner.
        validatorOwnerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(500), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`);

        validatorConfig = createValidatorConfig({
            Owner: validatorOwnerAccount.addr,
            Manager: validatorOwnerAccount.addr,
            MinEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            MaxAlgoPerPool: BigInt(AlgoAmount.Algos(5_000).microAlgos), // just do 5k per pool
            PercentToValidator: PctToValidator * 10000,
            ValidatorCommissionAddress: validatorOwnerAccount.addr,
            RewardTokenID: rewardTokenID,
            RewardPerPayout: tokenRewardPerPayout, // 1000 tokens per epoch
        });
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            validatorConfig,
            validatorMbr
        );

        // Add new pool - then we'll add stake and verify balances.
        // first pool needs extra .1 to cover MBR of opted-in reward token !
        poolKeys.push(
            await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                1,
                validatorOwnerAccount,
                poolMbr,
                poolInitMbr + BigInt(AlgoAmount.Algos(0.1).microAlgos)
            )
        );
        // should be [validator id, pool id (1 based)]
        expect(poolKeys[0].id).toEqual(BigInt(validatorId));
        expect(poolKeys[0].poolId).toEqual(1n);

        // now send a bunch of our reward token to the pool !
        await transferAsset(
            {
                from: tokenCreatorAccount,
                to: getApplicationAddress(poolKeys[0].poolAppId),
                assetId: Number(rewardTokenID),
                amount: 5000 * 10 ** decimals,
            },
            fixture.context.algod
        );

        poolClients.push(
            new StakingPoolClient(
                { sender: validatorOwnerAccount, resolveBy: 'id', id: poolKeys[0].poolAppId },
                fixture.context.algod
            )
        );

        // get the app id via contract call - it should match what we just got back in the poolKey
        poolAppId = (
            await validatorMasterClient.getPoolAppId(
                { validatorId: poolKeys[0].id, poolId: poolKeys[0].poolId },
                { sendParams: { populateAppCallResources: true } }
            )
        ).return!;
        expect(poolKeys[0].poolAppId).toEqual(poolAppId);

        const stateData = await getValidatorState(validatorMasterClient, validatorId);
        expect(stateData.numPools).toEqual(1);
        expect(stateData.totalAlgoStaked).toEqual(0n);
        expect(stateData.totalStakers).toEqual(0n);
        expect(stateData.rewardTokenHeldBack).toEqual(0n);

        const poolInfo = await getPoolInfo(validatorMasterClient, poolKeys[0]);
        expect(poolInfo.poolAppId).toEqual(BigInt(poolAppId));
        expect(poolInfo.totalStakers).toEqual(0);
        expect(poolInfo.totalAlgoStaked).toEqual(0n);

        // ok - all in working order. add second pool as well - no need to do
        poolKeys.push(
            await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                1,
                validatorOwnerAccount,
                poolMbr,
                poolInitMbr // no extra .1 for pool 2 !
            )
        );
        expect(poolKeys[1].poolId).toEqual(BigInt(2));
        poolClients.push(
            new StakingPoolClient(
                { sender: validatorOwnerAccount, resolveBy: 'id', id: poolKeys[1].poolAppId },
                fixture.context.algod
            )
        );
    });

    // add 2 stakers - full pool amount each
    test('addStakers', async () => {
        for (let i = 0; i < 2; i += 1) {
            const stakerAccount = await getTestAccount(
                { initialFunds: AlgoAmount.Algos(6000), suppressLog: true },
                fixture.context.algod,
                fixture.context.kmd
            );
            stakerAccounts.push(stakerAccount);
            // opt-in to reward token
            await assetOptIn({ account: stakerAccount, assetId: Number(rewardTokenID) }, fixture.context.algod);

            const stakeAmount = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(5000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
            );
            const [stakedPoolKey] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakerAccount,
                stakeAmount,
                0n
            );
            // each staker should land in diff pool because we're maxing the pool
            expect(stakedPoolKey.id).toEqual(poolKeys[i].id);
            expect(stakedPoolKey.poolId).toEqual(poolKeys[i].poolId);
            expect(stakedPoolKey.poolAppId).toEqual(poolKeys[i].poolAppId);

            const poolInfo = await getPoolInfo(validatorMasterClient, poolKeys[i]);
            expect(poolInfo.totalStakers).toEqual(1);
            expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount.microAlgos - Number(stakerMbr)));
        }

        expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(BigInt(2));
        expect((await getValidatorState(validatorMasterClient, validatorId)).totalAlgoStaked).toEqual(
            BigInt(AlgoAmount.Algos(10000).microAlgos)
        );
    });

    test('testFirstRewards', async () => {
        // increment time a day at a time per transaction
        await fixture.context.algod.setBlockOffsetTimestamp(60 * 60 * 24).do();

        let cumTokRewards = 0n;
        for (let poolIdx = 0; poolIdx < 2; poolIdx += 1) {
            consoleLogger.info(`testing rewards payout for pool # ${poolIdx + 1}`);
            const origValidatorState = await getValidatorState(validatorMasterClient, validatorId);
            const ownerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do();
            const stakersPriorToReward = await getStakeInfoFromBoxValue(poolClients[poolIdx]);
            const reward = AlgoAmount.Algos(200);
            // put some test 'reward' algos into each staking pool
            await transferAlgos(
                {
                    from: fixture.context.testAccount,
                    to: getApplicationAddress(poolKeys[poolIdx].poolAppId),
                    amount: reward,
                },
                fixture.context.algod
            );
            // Perform epoch payout calculation  - we also get back how much it cost to issue the txn
            const fees = await epochBalanceUpdate(poolClients[poolIdx]);
            const expectedValidatorReward = reward.microAlgos * (PctToValidator / 100);
            const newValidatorState = await getValidatorState(validatorMasterClient, validatorId);
            const newOwnerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do();
            // validator owner should have gotten the expected reward (minus the fees they just paid ofc)
            expect(newOwnerBalance.amount).toEqual(ownerBalance.amount - fees.microAlgos + expectedValidatorReward);

            // Verify all the stakers in the pool got what we think they should have
            const stakersAfterReward = await getStakeInfoFromBoxValue(poolClients[poolIdx]);

            const payoutRatio = await getTokenPayoutRatio(validatorMasterClient, validatorId);
            const tokenRewardForThisPool =
                (BigInt(tokenRewardPerPayout) * payoutRatio.PoolPctOfWhole[poolIdx]) / BigInt(1_000_000);
            cumTokRewards += tokenRewardForThisPool;

            await verifyRewardAmounts(
                fixture.context,
                (BigInt(reward.microAlgos) - BigInt(expectedValidatorReward)) as bigint,
                tokenRewardForThisPool, // we split evenly into 2 pools - so token reward should be as well
                stakersPriorToReward as StakedInfo[],
                stakersAfterReward as StakedInfo[],
                1 as number
            );

            // the total staked should have grown as well - reward minus what the validator was paid in their commission
            expect(Number(newValidatorState.totalAlgoStaked)).toEqual(
                Number(origValidatorState.totalAlgoStaked) + (reward.microAlgos - expectedValidatorReward)
            );

            // the reward tokens 'held' back should've grown by the token payout amount for this pool
            expect(newValidatorState.rewardTokenHeldBack).toEqual(cumTokRewards);
        }
    });

    test('extractRewards', async () => {
        for (let i = 0; i < 2; i += 1) {
            const origPoolInfo = await getPoolInfo(validatorMasterClient, poolKeys[i]);
            const origValidatorState = await getValidatorState(validatorMasterClient, validatorId);
            const stakerInfo = await getStakerInfo(poolClients[i], stakerAccounts[i]);
            const origStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[i].addr).do();
            const origStakerAssetBalance = await fixture.context.algod
                .accountAssetInformation(stakerAccounts[i].addr, Number(rewardTokenID))
                .do();

            // Remove all stake
            await removeStake(poolClients[i], stakerAccounts[i], AlgoAmount.Algos(0));
            const removeFees = AlgoAmount.MicroAlgos(7000).microAlgos;

            const newStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[i].addr).do();

            expect(BigInt(newStakerBalance.amount)).toEqual(
                BigInt(origStakerBalance.amount) + stakerInfo.balance - BigInt(removeFees)
            );
            // verify that pending reward token payout came to us
            const newStakerAssetBalance = await fixture.context.algod
                .accountAssetInformation(stakerAccounts[0].addr, Number(rewardTokenID))
                .do();
            expect(BigInt(newStakerAssetBalance['asset-holding'].amount)).toEqual(
                BigInt(origStakerAssetBalance['asset-holding'].amount) + stakerInfo.rewardTokenBalance
            );

            // no one should be left and be 0 balance
            const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, poolKeys[i]);
            expect(postRemovePoolInfo.totalStakers).toEqual(origPoolInfo.totalStakers - 1);
            expect(postRemovePoolInfo.totalAlgoStaked).toEqual(
                BigInt(origPoolInfo.totalAlgoStaked - stakerInfo.balance)
            );

            const newValidatorState = await getValidatorState(validatorMasterClient, validatorId);
            expect(newValidatorState.totalAlgoStaked).toEqual(origValidatorState.totalAlgoStaked - stakerInfo.balance);
            expect(newValidatorState.totalStakers).toEqual(origValidatorState.totalStakers - 1n);
            expect(newValidatorState.rewardTokenHeldBack).toEqual(
                BigInt(origValidatorState.rewardTokenHeldBack - stakerInfo.rewardTokenBalance)
            );
        }
    });
});

describe('TokenGatingByCreator', () => {
    beforeEach(fixture.beforeEach);
    beforeEach(logs.beforeEach);
    afterEach(logs.afterEach);

    let validatorId: number;

    let tokenCreatorAccount: Account;
    let validatorOwnerAccount: Account;
    let validatorConfig: ValidatorConfig;
    let firstPoolKey: ValidatorPoolKey;

    let gatingToken1Id: bigint;
    let gatingToken2Id: bigint;

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        // Create a token that will be required for stakers to possess in order to stake
        tokenCreatorAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(5000), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        gatingToken1Id = await createAsset(
            fixture.context.algod,
            tokenCreatorAccount,
            'Gating Token 1',
            'GATETK1',
            10,
            0
        );
        gatingToken2Id = await createAsset(
            fixture.context.algod,
            tokenCreatorAccount,
            'Gating Token 2',
            'GATETK2',
            10,
            0
        );

        // Fund a 'validator account' that will be the validator owner.
        validatorOwnerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(500), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`);

        validatorConfig = createValidatorConfig({
            Owner: validatorOwnerAccount.addr,
            Manager: validatorOwnerAccount.addr,
            MinEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            MaxAlgoPerPool: BigInt(MaxAlgoPerPool), // this comes into play in later tests !!
            PercentToValidator: 5 * 10000,
            ValidatorCommissionAddress: validatorOwnerAccount.addr,
            // stakers must possess any token created by tokenCreatorAccount
            EntryGatingType: GATING_TYPE_ASSETS_CREATED_BY,
            EntryGatingAddress: tokenCreatorAccount.addr,
            GatingAssetMinBalance: 2n, // require 2 so we can see if only having 1 fails us
        });
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            validatorConfig,
            validatorMbr
        );

        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr
        );
    });

    describe('stakeTest', () => {
        beforeEach(fixture.beforeEach);
        beforeEach(logs.beforeEach);
        afterEach(logs.afterEach);

        let stakerAccount: Account;
        let stakerCreatedTokenId: bigint;
        beforeAll(async () => {
            // Fund a 'staker account' that will be the new 'staker'
            stakerAccount = await getTestAccount(
                { initialFunds: AlgoAmount.Algos(5000), suppressLog: true },
                fixture.context.algod,
                fixture.context.kmd
            );

            await assetOptIn({ account: stakerAccount, assetId: Number(gatingToken1Id) }, fixture.context.algod);
            await assetOptIn({ account: stakerAccount, assetId: Number(gatingToken2Id) }, fixture.context.algod);
            // Send gating tokens to our staker for use in tests
            await transferAsset(
                {
                    from: tokenCreatorAccount,
                    to: stakerAccount,
                    assetId: Number(gatingToken1Id),
                    amount: 2,
                },
                fixture.context.algod
            );
            await transferAsset(
                {
                    from: tokenCreatorAccount,
                    to: stakerAccount,
                    assetId: Number(gatingToken2Id),
                    amount: 2,
                },
                fixture.context.algod
            );

            stakerCreatedTokenId = await createAsset(
                fixture.context.algod,
                stakerAccount,
                'Dummy Token',
                'DUMMY',
                10,
                0
            );
        });

        test('stakeNoTokenOffered', async () => {
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
            );
            await expect(
                addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmount1, 0n)
            ).rejects.toThrowError();
        });

        test('stakeWrongTokenOffered', async () => {
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
            );
            await expect(
                addStake(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    stakerAccount,
                    stakeAmount1,
                    stakerCreatedTokenId
                )
            ).rejects.toThrowError();
        });

        test('stakeWGatingToken1', async () => {
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
            );
            const [stakedPoolKey] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakerAccount,
                stakeAmount1,
                gatingToken1Id
            );
            // should match info from first staking pool
            expect(stakedPoolKey.id).toEqual(firstPoolKey.id);
            expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId);
            expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId);

            const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
            expect(poolInfo.totalStakers).toEqual(1);
            expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)));

            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n);
        });

        test('stakeWGatingToken2', async () => {
            const stakeAmount2 = AlgoAmount.MicroAlgos(AlgoAmount.Algos(1000).microAlgos);
            const [stakedPoolKey] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakerAccount,
                stakeAmount2,
                gatingToken2Id
            );
            // should match info from first staking pool
            expect(stakedPoolKey.id).toEqual(firstPoolKey.id);
            expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId);
            expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId);

            const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
            expect(poolInfo.totalStakers).toEqual(1);
            expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount2.microAlgos * 2));

            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n);
        });

        test('stakeWGatingToken2NotMeetingBalReq', async () => {
            // send 1 of the token back to creator - we should now fail to add more stake because we don't meet the token minimum
            await transferAsset(
                {
                    from: stakerAccount,
                    to: tokenCreatorAccount,
                    assetId: Number(gatingToken2Id),
                    amount: 1,
                },
                fixture.context.algod
            );

            await expect(
                addStake(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    stakerAccount,
                    AlgoAmount.MicroAlgos(AlgoAmount.Algos(1000).microAlgos),
                    gatingToken2Id
                )
            ).rejects.toThrowError();
        });
    });
});

describe('TokenGatingByAsset', () => {
    beforeEach(fixture.beforeEach);
    beforeEach(logs.beforeEach);
    afterEach(logs.afterEach);

    let validatorId: number;

    let tokenCreatorAccount: Account;
    let validatorOwnerAccount: Account;
    let validatorConfig: ValidatorConfig;
    let firstPoolKey: ValidatorPoolKey;

    let gatingToken1Id: bigint;
    let gatingToken2Id: bigint;

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        // Create a token that will be required for stakers to possess in order to stake
        tokenCreatorAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(5000), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        gatingToken1Id = await createAsset(
            fixture.context.algod,
            tokenCreatorAccount,
            'Gating Token 1 [Other by same]',
            'GATETK1',
            10,
            0
        );
        gatingToken2Id = await createAsset(
            fixture.context.algod,
            tokenCreatorAccount,
            'Gating Token 2 [Required]',
            'GATETK2',
            10,
            0
        );

        // Fund a 'validator account' that will be the validator owner.
        validatorOwnerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(500), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`);

        validatorConfig = createValidatorConfig({
            Owner: validatorOwnerAccount.addr,
            Manager: validatorOwnerAccount.addr,
            MinEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            MaxAlgoPerPool: BigInt(MaxAlgoPerPool), // this comes into play in later tests !!
            PercentToValidator: 5 * 10000,
            ValidatorCommissionAddress: validatorOwnerAccount.addr,
            // stakers must possess ONLY the second gating token - explicit id !
            EntryGatingType: GATING_TYPE_ASSET_ID,
            EntryGatingAssets: [gatingToken2Id, 0n, 0n, 0n],
            GatingAssetMinBalance: 2n, // require 2 so we can see if only having 1 fails us
        });
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            validatorConfig,
            validatorMbr
        );

        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr
        );
    });

    describe('stakeTest', () => {
        beforeEach(fixture.beforeEach);
        beforeEach(logs.beforeEach);
        afterEach(logs.afterEach);

        let stakerAccount: Account;
        let stakerCreatedTokenId: bigint;
        beforeAll(async () => {
            // Fund a 'staker account' that will be the new 'staker'
            stakerAccount = await getTestAccount(
                { initialFunds: AlgoAmount.Algos(5000), suppressLog: true },
                fixture.context.algod,
                fixture.context.kmd
            );

            await assetOptIn({ account: stakerAccount, assetId: Number(gatingToken1Id) }, fixture.context.algod);
            await assetOptIn({ account: stakerAccount, assetId: Number(gatingToken2Id) }, fixture.context.algod);
            // Send gating tokens to our staker for use in tests
            await transferAsset(
                {
                    from: tokenCreatorAccount,
                    to: stakerAccount,
                    assetId: Number(gatingToken1Id),
                    amount: 2,
                },
                fixture.context.algod
            );
            await transferAsset(
                {
                    from: tokenCreatorAccount,
                    to: stakerAccount,
                    assetId: Number(gatingToken2Id),
                    amount: 2,
                },
                fixture.context.algod
            );

            stakerCreatedTokenId = await createAsset(
                fixture.context.algod,
                stakerAccount,
                'Dummy Token',
                'DUMMY',
                10,
                0
            );
        });

        test('stakeNoTokenOffered', async () => {
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
            );
            await expect(
                addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmount1, 0n)
            ).rejects.toThrowError();
        });

        test('stakeWrongTokenOffered', async () => {
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
            );
            await expect(
                addStake(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    stakerAccount,
                    stakeAmount1,
                    stakerCreatedTokenId
                )
            ).rejects.toThrowError();
        });

        test('stakeWGatingToken1ShouldFail', async () => {
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
            );
            await expect(
                addStake(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    stakerAccount,
                    stakeAmount1,
                    gatingToken1Id
                )
            ).rejects.toThrowError();
        });

        test('stakeWGatingToken2ShouldPass', async () => {
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
            );
            const [stakedPoolKey] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakerAccount,
                stakeAmount1,
                gatingToken2Id
            );
            // should match info from first staking pool
            expect(stakedPoolKey.id).toEqual(firstPoolKey.id);
            expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId);
            expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId);

            const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
            expect(poolInfo.totalStakers).toEqual(1);
            expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)));

            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n);
        });

        test('stakeWGatingToken2NotMeetingBalReq', async () => {
            // send 1 of the token back to creator - we should now fail to add more stake because we don't meet the token minimum
            await transferAsset(
                {
                    from: stakerAccount,
                    to: tokenCreatorAccount,
                    assetId: Number(gatingToken2Id),
                    amount: 1,
                },
                fixture.context.algod
            );

            await expect(
                addStake(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    stakerAccount,
                    AlgoAmount.MicroAlgos(AlgoAmount.Algos(1000).microAlgos),
                    gatingToken2Id
                )
            ).rejects.toThrowError();
        });
    });
});

describe('TokenGatingMultAssets', () => {
    beforeEach(fixture.beforeEach);
    beforeEach(logs.beforeEach);
    afterEach(logs.afterEach);

    let validatorId: number;

    let tokenCreatorAccount: Account;
    let validatorOwnerAccount: Account;
    let validatorConfig: ValidatorConfig;
    let firstPoolKey: ValidatorPoolKey;

    const gatingTokens: bigint[] = [];

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        // Create a token that will be required for stakers to possess in order to stake
        tokenCreatorAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(5000), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        // create 4 dummy assets
        for (let i = 0; i < 4; i += 1) {
            gatingTokens.push(
                await createAsset(fixture.context.algod, tokenCreatorAccount, `Gating Token ${i}`, `GATETK${i}`, 10, 0)
            );
        }

        validatorOwnerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(500), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`);

        validatorConfig = createValidatorConfig({
            Owner: validatorOwnerAccount.addr,
            Manager: validatorOwnerAccount.addr,
            MinEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            MaxAlgoPerPool: BigInt(MaxAlgoPerPool), // this comes into play in later tests !!
            PercentToValidator: 5 * 10000,
            ValidatorCommissionAddress: validatorOwnerAccount.addr,
            // stakers must possess ONLY the second gating token - explicit id !
            EntryGatingType: GATING_TYPE_ASSET_ID,
            EntryGatingAssets: [gatingTokens[0], gatingTokens[1], gatingTokens[2], gatingTokens[3]],
            GatingAssetMinBalance: 2n, // require 2 so we can see if only having 1 fails
        });
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            validatorConfig,
            validatorMbr
        );

        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr
        );
    });

    describe('stakeTest', () => {
        beforeEach(fixture.beforeEach);
        beforeEach(logs.beforeEach);
        afterEach(logs.afterEach);

        let stakerAccount: Account;
        let stakerCreatedTokenId: bigint;
        beforeAll(async () => {
            // Fund a 'staker account' that will be the new 'staker'
            stakerAccount = await getTestAccount(
                { initialFunds: AlgoAmount.Algos(8000), suppressLog: true },
                fixture.context.algod,
                fixture.context.kmd
            );

            for (let i = 0; i < 4; i += 1) {
                await assetOptIn({ account: stakerAccount, assetId: Number(gatingTokens[i]) }, fixture.context.algod);
                await transferAsset(
                    {
                        from: tokenCreatorAccount,
                        to: stakerAccount,
                        assetId: Number(gatingTokens[i]),
                        amount: 2,
                    },
                    fixture.context.algod
                );
            }
            stakerCreatedTokenId = await createAsset(
                fixture.context.algod,
                stakerAccount,
                'Dummy Token',
                'DUMMY',
                10,
                0
            );
        });

        test('stakeNoTokenOffered', async () => {
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
            );
            await expect(
                addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmount1, 0n)
            ).rejects.toThrowError();
        });

        test('stakeWrongTokenOffered', async () => {
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
            );
            await expect(
                addStake(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    stakerAccount,
                    stakeAmount1,
                    stakerCreatedTokenId
                )
            ).rejects.toThrowError();
        });

        test('stakeWGatingTokens', async () => {
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
            );
            const [stakedPoolKey] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakerAccount,
                stakeAmount1,
                gatingTokens[0]
            );
            expect(stakedPoolKey.id).toEqual(firstPoolKey.id);
            expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId);
            expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId);

            let poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
            expect(poolInfo.totalStakers).toEqual(1);
            expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)));

            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n);

            // Now try w/ the rest of the tokens - all should succeed and should only add more stake
            for (let i = 1; i < 4; i += 1) {
                await addStake(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    stakerAccount,
                    AlgoAmount.Algos(1000),
                    gatingTokens[i]
                );
            }
            poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
            expect(poolInfo.totalStakers).toEqual(1);
            expect(poolInfo.totalAlgoStaked).toEqual(BigInt(AlgoAmount.Algos(1000).microAlgos * 4));
            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n);
        });

        test('stakeWGatingToken2ShouldPass', async () => {
            const stakeAmount1 = AlgoAmount.Algos(1000);
            const [stakedPoolKey] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakerAccount,
                stakeAmount1,
                gatingTokens[1]
            );
            expect(stakedPoolKey.id).toEqual(firstPoolKey.id);
            expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId);
            expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId);

            const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
            expect(poolInfo.totalStakers).toEqual(1);
            expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos * 5));
            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n);
        });

        test('stakeWGatingToken2NotMeetingBalReq', async () => {
            // send 1 of a token back to creator - we should now fail to add more stake because we don't meet the token minimum
            await transferAsset(
                {
                    from: stakerAccount,
                    to: tokenCreatorAccount,
                    assetId: Number(gatingTokens[1]),
                    amount: 1,
                },
                fixture.context.algod
            );

            await expect(
                addStake(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    stakerAccount,
                    AlgoAmount.MicroAlgos(AlgoAmount.Algos(1000).microAlgos),
                    gatingTokens[1]
                )
            ).rejects.toThrowError();
        });
    });
});

describe('SaturatedValidator', () => {
    beforeEach(fixture.beforeEach);
    beforeEach(logs.beforeEach);
    afterEach(logs.afterEach);

    let validatorId: number;

    let validatorOwnerAccount: Account;
    let stakerAccount: Account;
    let validatorConfig: ValidatorConfig;
    const pools: ValidatorPoolKey[] = [];

    let constraints: ProtocolConstraints;

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        constraints = await getProtocolConstraints(validatorMasterClient);

        // Fund a 'validator account' that will be the validator owner.
        validatorOwnerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(500), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`);

        validatorConfig = createValidatorConfig({
            Owner: validatorOwnerAccount.addr,
            Manager: validatorOwnerAccount.addr,
            MinEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            MaxAlgoPerPool: constraints.MaxAlgoPerPool,
            PayoutEveryXMins: 1,
            PercentToValidator: 5 * 10000,
            ValidatorCommissionAddress: validatorOwnerAccount.addr,
        });
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            validatorConfig,
            validatorMbr
        );

        pools.push(
            await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                1,
                validatorOwnerAccount,
                poolMbr,
                poolInitMbr
            )
        );

        stakerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(300e6), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
    });

    // Fill up the first pool completely
    test('stakeFillingPool', async () => {
        const stakeAmount = AlgoAmount.MicroAlgos(Number(constraints.MaxAlgoPerPool + stakerMbr));
        await addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmount, 0n);
        expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n);
        const poolInfo = await getPoolInfo(validatorMasterClient, pools[0]);
        expect(poolInfo.totalStakers).toEqual(1);
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount.microAlgos - Number(stakerMbr)));

        // try to add again - should fail
        await expect(
            addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakerAccount,
                AlgoAmount.MicroAlgos(1000),
                0n
            )
        ).rejects.toThrowError();
    });

    // Now we add 2 more pools, total of 3 - which means we can have up to 70m * 3 = 210m total stake yet in current config
    test('addPools', async () => {
        const curSoftMax = await getCurMaxStatePerPool(validatorMasterClient, validatorId);
        expect(curSoftMax).toEqual(constraints.MaxAlgoPerPool);

        for (let i = 0; i < 2; i += 1) {
            pools.push(
                await addStakingPool(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    1,
                    validatorOwnerAccount,
                    poolMbr,
                    poolInitMbr
                )
            );
        }
        expect((await getValidatorState(validatorMasterClient, validatorId)).numPools).toEqual(3);
        // Our maximum per pool should've changed now - to be max algo per validator / numNodes (3)
        const newSoftMax = await getCurMaxStatePerPool(validatorMasterClient, validatorId);
        expect(newSoftMax).toEqual(
            BigInt(Math.min(Number(constraints.MaxAlgoPerValidator / 3n), Number(constraints.MaxAlgoPerPool)))
        );
    });

    test('fillNewPools', async () => {
        // bump by 15 mins at a time, so we account for the entry time post-dating and can stake and be immediately
        // 100%
        await fixture.context.algod.setBlockOffsetTimestamp(60 * 15).do();

        const newSoftMax = await getCurMaxStatePerPool(validatorMasterClient, validatorId);

        let [poolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            AlgoAmount.MicroAlgos(Number(newSoftMax)),
            0n
        );
        expect(poolKey.poolId).toEqual(2n);

        const state = await getValidatorState(validatorMasterClient, validatorId);
        expect(state.totalAlgoStaked).toEqual(constraints.MaxAlgoPerPool + newSoftMax);

        // Fill again - this will put us at max and with current dev defaults at least - over saturation limit
        // 3 pools of 70m (210m) vs saturation limit of 10% of 2b or 200m.
        [poolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            AlgoAmount.MicroAlgos(Number(newSoftMax)),
            0n
        );
        expect(poolKey.poolId).toEqual(3n);
    });

    test('testPenalties', async () => {
        const state = await getValidatorState(validatorMasterClient, validatorId);
        const origPoolBalance = await getPoolAvailBalance(fixture.context, pools[2]);

        const tmpPoolClient = new StakingPoolClient(
            { sender: validatorOwnerAccount, resolveBy: 'id', id: pools[2].poolAppId },
            fixture.context.algod
        );
        const poolInfo = await getPoolInfo(validatorMasterClient, pools[2]);
        const rewardAmount = AlgoAmount.Algos(200).microAlgos;
        // ok, NOW it should be over the limit on next balance update - send a bit more algo - and it should be in
        // saturated state now - so reward gets diminished, validator gets nothing, rest goes to fee sink
        const rewardSender = await getTestAccount(
            { initialFunds: AlgoAmount.MicroAlgos(rewardAmount + 4e6), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        await transferAlgos(
            {
                from: rewardSender,
                to: getApplicationAddress(pools[2].poolAppId),
                amount: AlgoAmount.MicroAlgos(rewardAmount),
            },
            fixture.context.algod
        );
        const wNewRewardPoolBal = await getPoolAvailBalance(fixture.context, pools[2]);
        // balance should be excess above totalAlgoStaked now...
        expect(wNewRewardPoolBal).toEqual(poolInfo.totalAlgoStaked + BigInt(rewardAmount));

        // but after next epochBalanceUpdate - it should have grown - but not by as much (depends on ratio of stake vs saturation limit)
        const origFeeSinkBal = await fixture.context.algod.accountInformation(FEE_SINK_ADDR).do();
        await epochBalanceUpdate(tmpPoolClient);

        const postSaturatedPoolBal = await getPoolAvailBalance(fixture.context, pools[2]);

        const diminishedRewards = (BigInt(rewardAmount) * constraints.AmtConsideredSaturated) / state.totalAlgoStaked;
        expect(postSaturatedPoolBal).toEqual(poolInfo.totalAlgoStaked + diminishedRewards);
        // reward should've been reduced with rest going to fee sink
        const newFeeSinkBal = await fixture.context.algod.accountInformation(FEE_SINK_ADDR).do();
        expect(newFeeSinkBal.amount).toBeGreaterThanOrEqual(
            origFeeSinkBal.amount + (rewardAmount - Number(diminishedRewards))
        );

        // stake should've increased by diminishedRewards
        const newPoolInfo = await getPoolInfo(validatorMasterClient, pools[2]);
        const newPoolBalance = await getPoolAvailBalance(fixture.context, pools[2]);
        expect(newPoolBalance).toEqual(origPoolBalance + diminishedRewards);
        expect(newPoolBalance).toEqual(newPoolInfo.totalAlgoStaked);
    });
});

describe('StakeAddRemoveBugVerify', () => {
    beforeEach(fixture.beforeEach);
    beforeEach(logs.beforeEach);
    afterEach(logs.afterEach);

    let validatorId: number;
    let validatorOwnerAccount: Account;
    let firstPoolKey: ValidatorPoolKey;
    let firstPoolClient: StakingPoolClient;

    beforeAll(async () => {
        validatorOwnerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(500), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        const config = createValidatorConfig({
            Owner: validatorOwnerAccount.addr,
            Manager: validatorOwnerAccount.addr,
            ValidatorCommissionAddress: validatorOwnerAccount.addr,
            MinEntryStake: BigInt(AlgoAmount.Algos(1).microAlgos),
            MaxAlgoPerPool: BigInt(MaxAlgoPerPool), // this comes into play in later tests !!
            PercentToValidator: 50000, // 5%
            PoolsPerNode: MaxPoolsPerNode,
        });
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr
        );
        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr
        );
        firstPoolClient = new StakingPoolClient(
            { sender: validatorOwnerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod
        );
    });

    test('addRemoveStakers', async () => {
        const stakers: Account[] = [];
        for (let i = 0; i < 3; i += 1) {
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
        // we have 3 stakers, now stake 0, 2, 1.  Remove 2 - add stake for 1
        // with 1.0 bug it'll add entry for staker 1 twice
        const stakeAmt = AlgoAmount.MicroAlgos(
            AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
        );
        let [poolKey] = await addStake(fixture.context, validatorMasterClient, validatorId, stakers[0], stakeAmt, 0n);
        expect(poolKey.id).toEqual(firstPoolKey.id);
        [poolKey] = await addStake(fixture.context, validatorMasterClient, validatorId, stakers[2], stakeAmt, 0n);
        expect(poolKey.id).toEqual(firstPoolKey.id);
        [poolKey] = await addStake(fixture.context, validatorMasterClient, validatorId, stakers[1], stakeAmt, 0n);
        expect(poolKey.id).toEqual(firstPoolKey.id);

        // ledger should be staker 0, 2, 1, {empty}
        let stakerData = await getStakeInfoFromBoxValue(firstPoolClient);
        expect(encodeAddress(stakerData[0].staker.publicKey)).toEqual(stakers[0].addr);
        expect(encodeAddress(stakerData[1].staker.publicKey)).toEqual(stakers[2].addr);
        expect(encodeAddress(stakerData[2].staker.publicKey)).toEqual(stakers[1].addr);
        expect(encodeAddress(stakerData[3].staker.publicKey)).toEqual(ALGORAND_ZERO_ADDRESS_STRING);
        expect(stakerData[0].balance).toEqual(1000n * 1000000n);
        expect(stakerData[1].balance).toEqual(1000n * 1000000n);
        expect(stakerData[2].balance).toEqual(1000n * 1000000n);
        expect(stakerData[3].balance).toEqual(0n);

        // now remove staker 2's stake - and we should end up with ledger of 0, {empty}, 1, {empty}
        await removeStake(firstPoolClient, stakers[2], AlgoAmount.Algos(1000));
        stakerData = await getStakeInfoFromBoxValue(firstPoolClient);
        expect(encodeAddress(stakerData[0].staker.publicKey)).toEqual(stakers[0].addr);
        expect(encodeAddress(stakerData[1].staker.publicKey)).toEqual(ALGORAND_ZERO_ADDRESS_STRING);
        expect(encodeAddress(stakerData[2].staker.publicKey)).toEqual(stakers[1].addr);
        expect(encodeAddress(stakerData[3].staker.publicKey)).toEqual(ALGORAND_ZERO_ADDRESS_STRING);
        expect(stakerData[0].balance).toEqual(1000n * 1000000n);
        expect(stakerData[1].balance).toEqual(0n);
        expect(stakerData[2].balance).toEqual(1000n * 1000000n);
        expect(stakerData[3].balance).toEqual(0n);

        // now try to add more stake for staker 1... prior bug means it'd re-add in the first empty slot !
        // verify it just adds to existing stake in later slot
        [poolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakers[1],
            AlgoAmount.Algos(500),
            0n
        );
        expect(poolKey.id).toEqual(firstPoolKey.id);

        stakerData = await getStakeInfoFromBoxValue(firstPoolClient);
        expect(encodeAddress(stakerData[0].staker.publicKey)).toEqual(stakers[0].addr);
        expect(encodeAddress(stakerData[1].staker.publicKey)).toEqual(ALGORAND_ZERO_ADDRESS_STRING);
        expect(encodeAddress(stakerData[2].staker.publicKey)).toEqual(stakers[1].addr);
        expect(encodeAddress(stakerData[3].staker.publicKey)).toEqual(ALGORAND_ZERO_ADDRESS_STRING);
        expect(stakerData[0].balance).toEqual(1000n * 1000000n);
        expect(stakerData[1].balance).toEqual(0n);
        expect(stakerData[2].balance).toEqual(1500n * 1000000n);
        expect(stakerData[3].balance).toEqual(0n);
    });
});

// Remove skip when want to do full pool (200 stakers) testing
describe.skip('ValidatorWFullPoolWRewards', () => {
    beforeEach(fixture.beforeEach);
    beforeEach(logs.beforeEach);
    afterEach(logs.afterEach);

    let validatorId: number;
    let validatorOwnerAccount: Account;
    let poolAppId: bigint;
    let firstPoolKey: ValidatorPoolKey;
    let firstPoolClient: StakingPoolClient;

    const PctToValidator = 5;
    const NumStakers = MaxStakersPerPool;

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        await fixture.context.algod.setBlockOffsetTimestamp(0).do();

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
            MaxAlgoPerPool: BigInt(AlgoAmount.Algos(1000 * NumStakers).microAlgos), // this comes into play in later tests !!
            PercentToValidator: PctToValidator * 10000,
            ValidatorCommissionAddress: validatorOwnerAccount.addr,
        });
        validatorId = await addValidator(
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
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr
        );
        // should be [validator id, pool id (1 based)]
        expect(firstPoolKey.id).toEqual(BigInt(validatorId));
        expect(firstPoolKey.poolId).toEqual(1n);

        firstPoolClient = new StakingPoolClient(
            { sender: validatorOwnerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod
        );

        // get the app id via contract call - it should match what we just got back in poolKey[2]
        poolAppId = (
            await validatorMasterClient.getPoolAppId(
                { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                { sendParams: { populateAppCallResources: true } }
            )
        ).return!;
        expect(firstPoolKey.poolAppId).toEqual(poolAppId);

        const stateData = await getValidatorState(validatorMasterClient, validatorId);
        expect(stateData.numPools).toEqual(1);
        expect(stateData.totalAlgoStaked).toEqual(0n);
        expect(stateData.totalStakers).toEqual(0n);

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        expect(poolInfo.poolAppId).toEqual(BigInt(poolAppId));
        expect(poolInfo.totalStakers).toEqual(0);
        expect(poolInfo.totalAlgoStaked).toEqual(0n);
    });

    // Creates maxStakersPerPool stakers:
    test(
        'addStakers',
        async () => {
            for (let i = 0; i < NumStakers + 1; i += 1) {
                const stakerAccount = await getTestAccount(
                    { initialFunds: AlgoAmount.Algos(5000), suppressLog: true },
                    fixture.context.algod,
                    fixture.context.kmd
                );

                // now stake 1000(+mbr), min for this pool - for the first time - which means actual stake amount will be reduced
                // by 'first time staker' fee to cover MBR (which goes to VALIDATOR contract account, not staker contract account!)
                // we pay the extra here so the final staked amount should be exactly 1000
                const stakeAmount1 = AlgoAmount.MicroAlgos(
                    AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
                );
                let stakedPoolKey: ValidatorPoolKey;
                if (i < NumStakers) {
                    [stakedPoolKey] = await addStake(
                        fixture.context,
                        validatorMasterClient,
                        validatorId,
                        stakerAccount,
                        stakeAmount1,
                        0n
                    );
                } else {
                    // staker # numStakers + 1 should fail because no pool is available (because we exceeded max algo)
                    await expect(
                        addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmount1, 0n)
                    ).rejects.toThrowError();
                    continue;
                }
                // should match info from first staking pool
                expect(stakedPoolKey.id).toEqual(firstPoolKey.id);
                expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId);
                expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId);

                const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
                expect(poolInfo.totalStakers).toEqual(i + 1);
                expect(poolInfo.totalAlgoStaked).toEqual(
                    BigInt(stakeAmount1.microAlgos - Number(stakerMbr)) * BigInt(i + 1)
                );

                expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(
                    BigInt(i + 1)
                );
            }
        },
        4 * 60 * 1000 // 4 mins
    );

    test('testFirstRewards', async () => {
        // increment time a day at a time per transaction
        await fixture.context.algod.setBlockOffsetTimestamp(60 * 60 * 25).do();

        const origValidatorState = await getValidatorState(validatorMasterClient, validatorId);
        const ownerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do();
        const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient);

        const reward = AlgoAmount.Algos(2000);
        // put some test 'reward' algos into staking pool
        await transferAlgos(
            {
                from: fixture.context.testAccount,
                to: getApplicationAddress(firstPoolKey.poolAppId),
                amount: reward,
            },
            fixture.context.algod
        );

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey);
        consoleLogger.info(`pool stakers:${poolInfo.totalStakers}, staked:${poolInfo.totalAlgoStaked}`);

        // Perform epoch payout calculation  - we get back how much it cost to issue the txn
        const fees = await epochBalanceUpdate(firstPoolClient);
        const expectedValidatorReward = reward.microAlgos * (PctToValidator / 100);

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId);
        const newOwnerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do();
        // validator owner should have gotten the expected reward (minus the fees they just paid ofc)
        expect(newOwnerBalance.amount).toEqual(ownerBalance.amount - fees.microAlgos + expectedValidatorReward);

        // Verify all the stakers in the pool got what we think they should have
        const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient);

        // get time from most recent block to use as
        await verifyRewardAmounts(
            fixture.context,
            BigInt(reward.microAlgos) - BigInt(expectedValidatorReward),
            0n,
            stakersPriorToReward,
            stakersAfterReward,
            1
        );

        // the total staked should have grown as well - reward minus what the validator was paid in their commission
        expect(Number(newValidatorState.totalAlgoStaked)).toEqual(
            Number(origValidatorState.totalAlgoStaked) + (reward.microAlgos - expectedValidatorReward)
        );

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey);
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked);
    });
});
