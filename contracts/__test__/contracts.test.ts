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
    getMbrAmountsFromValidatorClient,
    getPoolInfo,
    getValidatorListBoxName,
    getValidatorState,
    ValidatorConfig,
} from './helpers';
// import { algoKitLogCaptureFixture } from '@algorandfoundation/algokit-utils/testing'

const fixture = algorandFixture();
const logs = algoKitLogCaptureFixture();

// algokit.Config.configure({ debug: true });

describe('ValidatorRegistry', () => {
    beforeEach(fixture.beforeEach);
    beforeEach(logs.beforeEach);
    afterEach(logs.afterEach);

    // app id of template app id
    let tmplPoolAppID: number;

    let validatorClient: ValidatorRegistryClient;
    let poolClient: StakingPoolClient;

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
        expect(validatorState.foo).toBeUndefined(); // sanity check that undefines states doesn't match 0.
    });

    test('addValidator', async () => {
        // Fund a 'validator account' that will be the validator owner.
        const validatorOwnerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(500), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`);
        const expectedNextValidatorID = (await validatorClient.getGlobalState()).numV!.asNumber() + 1;

        const config: ValidatorConfig = {
            PayoutEveryXDays: 1,
            PercentToValidator: 10000,
            ValidatorCommissionAddress: validatorOwnerAccount,
            MinEntryStake: AlgoAmount.Algos(1000).microAlgos,
            MaxAlgoPerPool: AlgoAmount.Algos(1_000_000).microAlgos,
            PoolsPerNode: 1,
            MaxNodes: 1,
        };

        // Now get MBR amounts via simulate from the contract
        const mbrAmounts = await getMbrAmountsFromValidatorClient(validatorClient);
        const addValidatorMbr = mbrAmounts[0];

        // Before validator can add pools it needs to be funded
        await validatorClient.appClient.fundAppAccount(AlgoAmount.MicroAlgos(Number(addValidatorMbr)));
        // Construct the validator pool itself !
        const validatorID = await addValidator(validatorClient, config, validatorOwnerAccount, expectedNextValidatorID);

        // Now add a pool - we have to include payment for its MBR as well
        const poolKey = await addStakingPool(
            fixture.context,
            validatorClient,
            validatorID,
            expectedNextValidatorID,
            validatorOwnerAccount
        );
        // should be [validator id, pool id (1 based)]
        expect(poolKey[0]).toBe(BigInt(validatorID));
        expect(poolKey[1]).toBe(BigInt(1));

        // get the app id of the specified validator/pool, so we can compare against the internal box state changes.
        const poolAppId = (
            await validatorClient.getPoolAppId({ poolKey }, { sendParams: { populateAppCallResources: true } })
        ).return!;
        expect(poolKey[2]).toBe(poolAppId);

        const newBoxData = await validatorClient.appClient.getBoxValue(getValidatorListBoxName(validatorID));

        const stateData = await getValidatorState(validatorClient, validatorID);
        expect(stateData.NumPools).toEqual(BigInt(1));
        expect(stateData.TotalAlgoStaked).toEqual(BigInt(0));
        expect(stateData.TotalStakers).toEqual(BigInt(0));

        const poolInfo = await getPoolInfo(validatorClient, poolKey);
        expect(poolInfo.PoolAppID).toBe(BigInt(poolAppId));
        expect(poolInfo.TotalStakers).toEqual(BigInt(0));
        expect(poolInfo.TotalAlgoStaked).toEqual(BigInt(0));

        // get current balance of staker pool
        const origStakePoolInfo = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do();

        // Fund a 'staker account' that will be the new 'staker'
        const stakerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(5000), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        consoleLogger.info(`staker account ${stakerAccount.addr}`);

        const mbrs = await getMbrAmountsFromValidatorClient(validatorClient);
        const stakerMbr = mbrs[2];

        let stakeAmount = AlgoAmount.Algos(900);
        const stakedPoolKey = await addStake(fixture.context, validatorClient, validatorID, stakerAccount, stakeAmount);
        // should be same as what we added prior
        expect(stakedPoolKey[0]).toBe(poolKey[0]);
        expect(stakedPoolKey[1]).toBe(poolKey[1]);
        expect(stakedPoolKey[2]).toBe(poolKey[2]);

        const stakePt1Balance = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do();
        expect(stakePt1Balance.amount).toBe(origStakePoolInfo.amount + stakeAmount.microAlgos - Number(stakerMbr));

        // stake again for 1000 more - should go to same pool.
        stakeAmount = AlgoAmount.Algos(1000);
        const stakedKey2 = await addStake(fixture.context, validatorClient, validatorID, stakerAccount, stakeAmount);
        // should be same as what we added prior
        expect(stakedKey2[0]).toBe(poolKey[0]);
        expect(stakedKey2[1]).toBe(poolKey[1]);
        expect(stakedKey2[2]).toBe(poolKey[2]);

        const stakePt2Balance = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do();
        expect(stakePt2Balance.amount).toBe(stakePt1Balance.amount + stakeAmount.microAlgos);
        const stakerAcctBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do();
        expect(stakerAcctBalance.amount).toBe(
            AlgoAmount.Algos(5000).microAlgos -
                AlgoAmount.Algos(900).microAlgos -
                AlgoAmount.Algos(1000).microAlgos -
                AlgoAmount.Algos(0.006 * 2).microAlgos /* 6 txn fee cost per staking */
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
