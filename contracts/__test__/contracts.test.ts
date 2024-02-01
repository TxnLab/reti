import { afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import { algoKitLogCaptureFixture, algorandFixture, getTestAccount } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';
// import { algoKitLogCaptureFixture } from '@algorandfoundation/algokit-utils/testing'
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import {
    decodeAddress,
    encodeUint64,
    Account,
    makePaymentTxnWithSuggestedParamsFromObject,
    SuggestedParams,
} from 'algosdk';
import { LogicError } from '@algorandfoundation/algokit-utils/types/logic-error';
import { StakingPoolClient } from '../contracts/clients/StakingPoolClient';
import { ValidatorRegistryClient } from '../contracts/clients/ValidatorRegistryClient';

const fixture = algorandFixture();
const logs = algoKitLogCaptureFixture();

let validatorClient: ValidatorRegistryClient;
let poolClient: StakingPoolClient;

/** The suggested params for any manualtransactions */
let suggestedParams: SuggestedParams;

// app id of template app id
let tmplPoolAppID: number;

algokit.Config.configure({ debug: true });

type ValidatorConfig = {
    PayoutEveryXDays: uint16; // Payout frequency - ie: 7, 30, etc.
    PercentToValidator: uint32; // Payout percentage expressed w/ four decimals - ie: 50000 = 5% -> .0005 -
    ValidatorCommissionAddress: Account; // account that receives the validation commission each epoch payout
    PoolsPerNode: uint8; // Number of pools to allow per node (max of 4 is recommended)
    MaxNodes: uint16; // Maximum number of nodes the validator is stating they'll allow
};

function validatorConfigAsArray(config: ValidatorConfig): [number, number, string, number, number] {
    return [
        config.PayoutEveryXDays,
        config.PercentToValidator,
        config.ValidatorCommissionAddress.addr,
        config.PoolsPerNode,
        config.MaxNodes,
    ];
}

describe('ValidatorRegistry', () => {
    beforeEach(fixture.beforeEach);
    beforeEach(logs.beforeEach);
    afterEach(logs.afterEach);

    beforeAll(async () => {
        await fixture.beforeEach();
        const { algod, testAccount } = fixture.context;

        suggestedParams = await algod.getTransactionParams().do();

        // First we have to create dummy instance of a pool that we can use as template contract for validator
        // which it can use to create new instances of that contract for staking pool.
        poolClient = new StakingPoolClient({ sender: testAccount, resolveBy: 'id', id: 0 }, algod);
        const tmplPool = await poolClient.create.createApplication({
            creatingContractID: 0,
            validatorID: 0,
            poolID: 0,
            owner: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
            manager: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
        });
        tmplPoolAppID = tmplPool.appId as number;
        validatorClient = new ValidatorRegistryClient(
            {
                sender: testAccount,
                resolveBy: 'id',
                id: 0,
                deployTimeParams: { StakingPoolTemplateAppID: tmplPool.appId },
            },
            algod
        );

        const validatorApp = await validatorClient.create.createApplication({});

        // Add jest checks to verify that the constructed validator contract is initialized as expected
        expect(validatorApp.appId).toBeDefined();
        expect(validatorApp.appAddress).toBeDefined();
        const validatorState = await validatorClient.appClient.getGlobalState();
        expect(validatorState.numV.value).toBe(0);
        expect(validatorState.foo).toBeUndefined(); // sanity check that undefines states doesn't match 0.

        // Now we need to fund the validator contract itself to cover its MBR !
        await validatorClient.appClient.fundAppAccount(AlgoAmount.Algos(1.0799));
    });

    test('addValidator', async () => {
        const appRef = await validatorClient.appClient.getAppReference();

        // Fund a 'validator account' that will be the validator owner.
        const vldtrAcct = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(500), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        consoleLogger.info(`validator account ${vldtrAcct.addr}`);
        const validatorState = await validatorClient.appClient.getGlobalState();
        const nextValidator = (validatorState.numV.value as number) + 1;

        const config: ValidatorConfig = {
            PayoutEveryXDays: 1,
            PercentToValidator: 10000,
            ValidatorCommissionAddress: vldtrAcct,
            PoolsPerNode: 1,
            MaxNodes: 1,
        };

        // Construct the validator pool
        const vldtrId = await addValidator(config, vldtrAcct, nextValidator);

        const origValidListData = await validatorClient.appClient.getBoxValue(getValidatorListBoxName(vldtrId));

        const poolKey = await addStakingPool(vldtrId, nextValidator, vldtrAcct);
        // should be [validator id, pool id (1 based)]
        expect(poolKey[0]).toBe(BigInt(vldtrId));
        expect(poolKey[1]).toBe(BigInt(1));

        // get the app id of the specified validator/pool so we can compare against the internal box state changes.
        const poolAppId = (
            await validatorClient.getPoolApp(
                { poolKey: [poolKey[0], poolKey[1]] },
                { sendParams: { populateAppCallResources: true } }
            )
        ).return!;

        const newBoxData = await validatorClient.appClient.getBoxValue(getValidatorListBoxName(vldtrId));
        // ensure that bytes 121-122 is equal to numpools uint16 value
        expect(newBoxData.slice(121, 123)).toEqual(encodeUint64(1).slice(6, 8));
        // bytes 549-557 will contain the first pool's stored app id
        expect(newBoxData.slice(549, 557)).toEqual(encodeUint64(Number(poolAppId)));
        // compareAndLogUint8Arrays(origValidListData, newBoxData);

        // Fund a 'staker account' that will be the validator owner.
        const stakerAccount = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(1000), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        consoleLogger.info(`staker account ${stakerAccount.addr}`);

        const newPoolKey = await addStake(vldtrId, stakerAccount, AlgoAmount.Algos(900));
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

async function addValidator(config: ValidatorConfig, vldtrAcct: Account, nextValidator: number) {
    try {
        return Number(
            (
                await validatorClient.addValidator(
                    {
                        config: validatorConfigAsArray(config),
                        manager: vldtrAcct.addr,
                        owner: vldtrAcct.addr,
                        nfdAppID: 0,
                    },
                    {
                        boxes: [
                            { appId: 0, name: getValidatorListBoxName(nextValidator) },
                            { appId: 0, name: '' }, // buy more i/o
                        ],
                        // sendParams: {populateAppCallResources:true},
                    }
                )
            ).return!
        );
    } catch (exception) {
        console.log((exception as LogicError).message);
        throw exception;
    }
}

async function addStakingPool(vldtrId: number, nextValidator: number, vldtrAcct: Account) {
    try {
        // Now add a staking pool
        return Array.from(
            (
                await validatorClient.addPool(
                    { validatorID: vldtrId },
                    {
                        sendParams: {
                            fee: AlgoAmount.MicroAlgos(2000),
                            // populateAppCallResources:true
                        },
                        apps: [tmplPoolAppID], // needsto reference template to create new instance
                        boxes: [
                            { appId: 0, name: getValidatorListBoxName(nextValidator) },
                            { appId: 0, name: '' }, // buy more i/o
                        ],
                        sender: vldtrAcct,
                    }
                )
            ).return!.values()
        );
    } catch (exception) {
        console.log((exception as LogicError).message);
        throw exception;
    }
}

async function addStake(vldtrId: number, staker: Account, algoAmount: AlgoAmount) {
    try {
        const appRef = await validatorClient.appClient.getAppReference();

        const poolKey = (
            await validatorClient.findPoolForStaker(
                { validatorID: vldtrId, staker: staker.addr, amountToStake: algoAmount.microAlgos },
                {
                    sendParams: {
                        fee: AlgoAmount.MicroAlgos(2000),
                        populateAppCallResources: true,
                    },
                }
            )
        ).return!;

        const poolAppId = (
            await validatorClient.getPoolAppId({ poolKey }, { sendParams: { populateAppCallResources: true } })
        ).return!;

        // Pay the stake to the validator contract
        const stakeTransfer = makePaymentTxnWithSuggestedParamsFromObject({
            from: staker.addr,
            to: appRef.appAddress,
            amount: algoAmount.microAlgos,
            suggestedParams,
        });
        // compose txn group that pays, then adds stake
        const txnResp = await validatorClient
            .compose()
            .addTransaction({ transaction: stakeTransfer, signer: staker })
            .addStake(
                { validatorID: vldtrId, amountToStake: algoAmount.microAlgos },
                {
                    sendParams: {
                        fee: AlgoAmount.MicroAlgos(6000),
                        // populateAppCallResources:true
                    },
                    apps: [tmplPoolAppID, Number(poolAppId)],
                    boxes: [
                        { appId: 0, name: getValidatorListBoxName(vldtrId) },
                        { appId: 0, name: '' }, // buy more i/o
                        { appId: 0, name: getStakerPoolSetName(staker) },
                        { appId: Number(poolAppId), name: new TextEncoder().encode('stakers') },
                        { appId: Number(poolAppId), name: '' },
                    ],
                    sender: staker,
                }
            )
            .execute();
        // ).simulate();
        // .simulate(<SimulateOptions>{allowMoreLogging:true, execTraceConfig:{enable:true, stackChange:true}});
        const foo = 1;
    } catch (exception) {
        console.log((exception as LogicError).message);
        throw exception;
    }
}

function concatUint8Arrays(a: Uint8Array, b: Uint8Array): Uint8Array {
    const result = new Uint8Array(a.length + b.length);
    result.set(a);
    result.set(b, a.length);
    return result;
}

function getValidatorListBoxName(validatorID: number) {
    const prefix = new TextEncoder().encode('v');
    return concatUint8Arrays(prefix, encodeUint64(validatorID));
}

function getStakerPoolSetName(stakerAccount: Account) {
    const prefix = new TextEncoder().encode('sps');
    return concatUint8Arrays(prefix, decodeAddress(stakerAccount.addr).publicKey);
}
