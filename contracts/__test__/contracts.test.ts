import { afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import { algoKitLogCaptureFixture, algorandFixture, getTestAccount } from '@algorandfoundation/algokit-utils/testing';
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { Account, getApplicationAddress } from 'algosdk';
import { LogicError } from '@algorandfoundation/algokit-utils/types/logic-error';
import { StakingPoolClient } from '../contracts/clients/StakingPoolClient';
import { ValidatorRegistryClient } from '../contracts/clients/ValidatorRegistryClient';
import {
    addStake,
    addStakingPool,
    addValidator,
    argsFromPoolKey,
    createValidatorConfig,
    getMbrAmountsFromValidatorClient,
    getPoolInfo,
    getValidatorState,
    removeStake,
    ValidatorPoolKey,
} from './helpers';
// import { algoKitLogCaptureFixture } from '@algorandfoundation/algokit-utils/testing'

const fixture = algorandFixture();
const logs = algoKitLogCaptureFixture();

// algokit.Config.configure({ debug: true });

const MaxAlgoPerPool = AlgoAmount.Algos(100_000).microAlgos;
let validatorClient: ValidatorRegistryClient;
let validatorAppID: bigint;
let poolClient: StakingPoolClient;

let validatorMbr: bigint;
let poolMbr: bigint;
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
        owner: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
        manager: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
        minAllowedStake: 1_000_000,
        maxStakeAllowed: 0,
    });
    validatorClient = new ValidatorRegistryClient(
        {
            sender: testAccount,
            resolveBy: 'id',
            id: 0,
        },
        algod
    );

    const validatorApp = await validatorClient.create.createApplication({ poolTemplateAppID: tmplPool.appId });
    // verify that the constructed validator contract is initialized as expected
    expect(validatorApp.appId).toBeDefined();
    expect(validatorApp.appAddress).toBeDefined();
    const validatorState = await validatorClient.appClient.getGlobalState();
    expect(validatorState.numV.value).toBe(0);
    expect(validatorState.foo).toBeUndefined(); // sanity check that undefined states doesn't match 0.

    validatorAppID = validatorApp.appId as bigint;

    [validatorMbr, poolMbr, stakerMbr] = await getMbrAmountsFromValidatorClient(validatorClient);
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
        const validatorsAppRef = await validatorClient.appClient.getAppReference();
        const origMbr = (await fixture.context.algod.accountInformation(validatorsAppRef.appAddress).do())[
            'min-balance'
        ];

        // need .1 ALGO for things to really work at all w/ this validator contract account so get that out of the way
        await validatorClient.appClient.fundAppAccount(AlgoAmount.Algos(0.1));

        const config = createValidatorConfig({
            ValidatorCommissionAddress: validatorOwnerAccount.addr,
        });
        let expectedID = 1;
        let validatorID = await addValidator(validatorClient, validatorOwnerAccount, config, validatorMbr);
        expect(validatorID).toBe(expectedID);
        const newMbr = (await fixture.context.algod.accountInformation(validatorsAppRef.appAddress).do())[
            'min-balance'
        ];
        expect(newMbr).toBe(origMbr + Number(validatorMbr));

        expectedID += 1;
        validatorID = await addValidator(validatorClient, validatorOwnerAccount, config, validatorMbr);
        expect(validatorID).toBe(expectedID);
        expectedID += 1;
        validatorID = await addValidator(validatorClient, validatorOwnerAccount, config, validatorMbr);
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
            MinEntryStake: AlgoAmount.Algos(1000).microAlgos,
            MaxAlgoPerPool, // this comes into play in later tests !!
            ValidatorCommissionAddress: validatorOwnerAccount.addr,
        });
        validatorID = await addValidator(validatorClient, validatorOwnerAccount, config, validatorMbr);

        // Add new pool - then we'll add stake and verify balances.
        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorClient,
            validatorID,
            validatorOwnerAccount,
            poolMbr
        );
        // should be [validator id, pool id (1 based)]
        expect(firstPoolKey.ID).toBe(BigInt(validatorID));
        expect(firstPoolKey.PoolID).toBe(BigInt(1));

        // get the app id via contract call - it should match what we just got back in poolKey[2]
        poolAppId = (
            await validatorClient.getPoolAppId(
                { poolKey: argsFromPoolKey(firstPoolKey) },
                { sendParams: { populateAppCallResources: true } }
            )
        ).return!;
        expect(firstPoolKey.PoolAppID).toBe(poolAppId);

        const stateData = await getValidatorState(validatorClient, validatorID);
        expect(stateData.NumPools).toEqual(BigInt(1));
        expect(stateData.TotalAlgoStaked).toEqual(BigInt(0));
        expect(stateData.TotalStakers).toEqual(BigInt(0));

        const poolInfo = await getPoolInfo(validatorClient, firstPoolKey);
        expect(poolInfo.PoolAppID).toBe(BigInt(poolAppId));
        expect(poolInfo.TotalStakers).toEqual(BigInt(0));
        expect(poolInfo.TotalAlgoStaked).toEqual(BigInt(0));
    });

    test('firstStaker', async () => {
        // get current balance of staker pool
        const origStakePoolInfo = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do();

        // Fund a 'staker account' that will be the new 'staker'
        const stakerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(5000), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        // Start by funding 'not enough' (we pay minimum stake [but no mbr]) - should fail (!)
        await expect(
            addStake(fixture.context, validatorClient, validatorID, stakerAccount, AlgoAmount.Algos(1000))
        ).rejects.toThrowError();

        // now stake 1000(+mbr), min for this pool - for the first time - which means actual stake amount will be reduced
        // by 'first time staker' fee to cover MBR (which goes to VALIDATOR contract account, not staker contract account!)
        const stakeAmount1 = AlgoAmount.MicroAlgos(
            AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
        );
        const stakedPoolKey = await addStake(
            fixture.context,
            validatorClient,
            validatorID,
            stakerAccount,
            stakeAmount1
        );
        // should match info from first staking pool
        expect(stakedPoolKey.ID).toBe(firstPoolKey.ID);
        expect(stakedPoolKey.PoolID).toBe(firstPoolKey.PoolID);
        expect(stakedPoolKey.PoolAppID).toBe(firstPoolKey.PoolAppID);

        const poolBalance1 = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do();
        expect(poolBalance1.amount).toBe(origStakePoolInfo.amount + stakeAmount1.microAlgos - Number(stakerMbr));

        // now try to remove partial amount - which should fail because it will take staked amount to < its 'minimum amount'
        // await removeStake9
        const explicitPoolClient = new StakingPoolClient(
            { sender: stakerAccount, resolveBy: 'id', id: stakedPoolKey.PoolAppID },
            fixture.context.algod
        );
        await removeStake(
            fixture.context,
            validatorAppID,
            explicitPoolClient,
            stakerAccount,
            AlgoAmount.Algos(200)
        );

        // stake again for 1000 more - should go to same pool (!)
        const stakeAmount2 = AlgoAmount.Algos(1000);
        const stakedKey2 = await addStake(fixture.context, validatorClient, validatorID, stakerAccount, stakeAmount2);
        // should be same as what we added prior
        expect(stakedKey2.ID).toBe(firstPoolKey.ID);
        expect(stakedKey2.PoolID).toBe(firstPoolKey.PoolID);
        expect(stakedKey2.PoolAppID).toBe(firstPoolKey.PoolAppID);

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
    });

    test('nextStaker', async () => {
        // get current balance of staker pool
        const origStakePoolInfo = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do();

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
            validatorClient,
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
    });

    test('validatorPoolCheck', async () => {
        const poolInfo = await getPoolInfo(validatorClient, firstPoolKey);
        expect(poolInfo.PoolAppID).toBe(BigInt(poolAppId));
        expect(poolInfo.TotalStakers).toBe(BigInt(2));
        expect(poolInfo.TotalAlgoStaked).toBe(BigInt(AlgoAmount.Algos(4000).microAlgos - Number(stakerMbr)));
    });

    test('add3PoolsAndFill', async () => {
        const pools = [];
        const stakers = [];

        for (let i = 0; i < 3; i++) {
            const newPool = await addStakingPool(
                fixture.context,
                validatorClient,
                validatorID,
                validatorOwnerAccount,
                poolMbr
            );
            expect(newPool.PoolID).toBe(BigInt(2 + i));
            pools.push(newPool);
        }

        for (let i = 0; i < 3; i++) {
            const poolInfo = await getPoolInfo(validatorClient, pools[i]);
            expect(poolInfo.PoolAppID).toBe(pools[i].PoolAppID);
            expect(poolInfo.TotalStakers).toEqual(BigInt(0));
            expect(poolInfo.TotalAlgoStaked).toEqual(BigInt(0));
        }

        // now create 3 new stakers - with tons of algo and add such that each pool is basically completely full.
        // add stake for each - each time should work and go to new pool (starting with first pool we added - the one
        // that's already there shouldn't have room).  Then next add of same size should fail.. then next add of something
        // small should go to first pool again
        for (let i = 0; i < 4; i++) {
            // fund some new staker accounts (4)
            const stakerAccount = await getTestAccount(
                {
                    initialFunds: AlgoAmount.MicroAlgos(MaxAlgoPerPool + 200_000), // save some for mbr/txns
                    suppressLog: true,
                },
                fixture.context.algod,
                fixture.context.kmd
            );
            stakers.push(stakerAccount);
        }

        // iterate stakers using forEach
        for (let i = 0; i < 3; i++) {
            const stakeAmount = AlgoAmount.MicroAlgos(
                AlgoAmount.MicroAlgos(MaxAlgoPerPool).microAlgos - AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos
            );
            const stakedPoolKey = await addStake(
                fixture.context,
                validatorClient,
                validatorID,
                stakers[i],
                stakeAmount
            );
            // should go to each pool in succession since it's basically the entire pool
            expect(stakedPoolKey.ID).toBe(pools[i].ID);
            expect(stakedPoolKey.PoolID).toBe(pools[i].PoolID);
            expect(stakedPoolKey.PoolAppID).toBe(pools[i].PoolAppID);
        }
        // now try to add large stake from staker 4... should fail... nothing free
        await expect(
            addStake(fixture.context, validatorClient, validatorID, stakers[3], AlgoAmount.MicroAlgos(MaxAlgoPerPool))
        ).rejects.toThrowError();

        // now try to add smallish stake from staker 4... should go to very first pool
        const stakerAcctOrigBalance = await fixture.context.algod.accountInformation(stakers[3].addr).do();
        const stakeAmount1 = AlgoAmount.Algos(2000);
        const stakedPoolKey = await addStake(fixture.context, validatorClient, validatorID, stakers[3], stakeAmount1);
        expect(stakedPoolKey.ID).toBe(firstPoolKey.ID);
        expect(stakedPoolKey.PoolID).toBe(firstPoolKey.PoolID);
        expect(stakedPoolKey.PoolAppID).toBe(firstPoolKey.PoolAppID);
        // ensure their balance decreased appropriately..
        const stakerAcctNewBalance = await fixture.context.algod.accountInformation(stakers[3].addr).do();
        expect(stakerAcctNewBalance.amount).toBe(
            stakerAcctOrigBalance.amount -
                stakeAmount1.microAlgos -
                AlgoAmount.Algos(0.006 * 1).microAlgos /* 6 txn fee cost per staking */
        );
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
