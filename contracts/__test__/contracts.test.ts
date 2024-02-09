import { afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import { algoKitLogCaptureFixture, algorandFixture, getTestAccount } from '@algorandfoundation/algokit-utils/testing';
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { getApplicationAddress } from 'algosdk';
import { LogicError } from '@algorandfoundation/algokit-utils/types/logic-error';
import { StakingPoolClient } from '../contracts/clients/StakingPoolClient';
import { ValidatorRegistryClient } from '../contracts/clients/ValidatorRegistryClient';
import {
    addStake,
    addStakingPool,
    addValidator,
    createValidatorConfig,
    getMbrAmountsFromValidatorClient,
    getPoolInfo,
    getValidatorState,
} from './helpers';
// import { algoKitLogCaptureFixture } from '@algorandfoundation/algokit-utils/testing'

const fixture = algorandFixture();
const logs = algoKitLogCaptureFixture();

// algokit.Config.configure({ debug: true });

// app id of template app id
let tmplPoolAppID: number;

let validatorClient: ValidatorRegistryClient;
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
    tmplPoolAppID = tmplPool.appId as number;
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

    [validatorMbr, poolMbr, stakerMbr] = await getMbrAmountsFromValidatorClient(validatorClient);
});

describe('ValidatorAddCheck', () => {
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

        const config = createValidatorConfig({ ValidatorCommissionAddress: validatorOwnerAccount.addr });
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
    let poolAppId: bigint;
    let poolKey: [bigint, bigint, bigint];

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        // Fund a 'validator account' that will be the validator owner.
        const validatorOwnerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(500), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`);

        const config = createValidatorConfig({
            ValidatorCommissionAddress: validatorOwnerAccount.addr,
            MinEntryStake: AlgoAmount.Algos(1000).microAlgos,
        });
        validatorID = await addValidator(validatorClient, validatorOwnerAccount, config, validatorMbr);

        // Add new pool - then we'll add stake and verify balances.
        poolKey = await addStakingPool(fixture.context, validatorClient, validatorID, validatorOwnerAccount, poolMbr);
        // should be [validator id, pool id (1 based)]
        expect(poolKey[0]).toBe(BigInt(validatorID));
        expect(poolKey[1]).toBe(BigInt(1));

        // get the app id via contract call - it should match what we just got back in poolKey[2]
        poolAppId = (
            await validatorClient.getPoolAppId({ poolKey }, { sendParams: { populateAppCallResources: true } })
        ).return!;
        expect(poolKey[2]).toBe(poolAppId);

        const stateData = await getValidatorState(validatorClient, validatorID);
        expect(stateData.NumPools).toEqual(BigInt(1));
        expect(stateData.TotalAlgoStaked).toEqual(BigInt(0));
        expect(stateData.TotalStakers).toEqual(BigInt(0));

        const poolInfo = await getPoolInfo(validatorClient, poolKey);
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
        // Start by funding 'not enough' (for minimum stake) - should fail (!)
        await expect(
            addStake(fixture.context, validatorClient, validatorID, stakerAccount, AlgoAmount.Algos(900))
        ).rejects.toThrowError();

        // now stake 10000, min for this pool - for the first time - which means actual stake amount will be reduced
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
        // should be same as what we added prior
        expect(stakedPoolKey[0]).toBe(poolKey[0]);
        expect(stakedPoolKey[1]).toBe(poolKey[1]);
        expect(stakedPoolKey[2]).toBe(poolKey[2]);

        const poolBalance1 = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do();
        expect(poolBalance1.amount).toBe(origStakePoolInfo.amount + stakeAmount1.microAlgos - Number(stakerMbr));

        // stake again for 1000 more - should go to same pool (!)
        const stakeAmount2 = AlgoAmount.Algos(1000);
        const stakedKey2 = await addStake(fixture.context, validatorClient, validatorID, stakerAccount, stakeAmount2);
        // should be same as what we added prior
        expect(stakedKey2[0]).toBe(poolKey[0]);
        expect(stakedKey2[1]).toBe(poolKey[1]);
        expect(stakedKey2[2]).toBe(poolKey[2]);

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
        expect(stakedPoolKey[0]).toBe(poolKey[0]);
        expect(stakedPoolKey[1]).toBe(poolKey[1]);
        expect(stakedPoolKey[2]).toBe(poolKey[2]);

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
        const poolInfo = await getPoolInfo(validatorClient, poolKey);
        expect(poolInfo.PoolAppID).toBe(BigInt(poolAppId));
        expect(poolInfo.TotalStakers).toBe(BigInt(2));
        expect(poolInfo.TotalAlgoStaked).toBe(BigInt(AlgoAmount.Algos(4000).microAlgos));
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

function compareAndLogUint8Arrays(a: Uint8Array, b: Uint8Array): void {
    if (a.length !== b.length) {
        console.log('The Uint8Array inputs have different lengths.');
        return;
    }

    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            console.log(`Difference found at index ${i}: A = ${a[i]}, B = ${b[i]}`);
        }
    }
}
