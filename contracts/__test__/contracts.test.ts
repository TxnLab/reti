import { afterEach, beforeAll, beforeEach, describe, test } from '@jest/globals';
import { algoKitLogCaptureFixture, algorandFixture, getTestAccount } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';
// import { algoKitLogCaptureFixture } from '@algorandfoundation/algokit-utils/testing'
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { decodeAddress, encodeAddress, encodeUint64, Account } from 'algosdk';
import { LogicError } from '@algorandfoundation/algokit-utils/types/logic-error';
import { StakingPoolClient } from '../contracts/clients/StakingPoolClient';
import { ValidatorRegistryClient } from '../contracts/clients/ValidatorRegistryClient';
import { microAlgos } from "@algorandfoundation/algokit-utils";

const fixture = algorandFixture();
const logs = algoKitLogCaptureFixture();

let validatorClient: ValidatorRegistryClient;
let poolClient: StakingPoolClient;

// app id of template app id
let tmplPoolAppID: number;

algokit.Config.configure({ debug: true });

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
        consoleLogger.info(`deployed app id:${validatorApp.appId}, and address is:${validatorApp.appAddress}`);

        // Now we need to fund the validator contract to cover its MBR !
        validatorClient.appClient.fundAppAccount(AlgoAmount.Algos(5));
        // transferAlgos({ from: testAccount, to: validatorApp.appAddress, amount: AlgoAmount.Algos(5) }, algod);
    });

    test('addValidator', async () => {
        const appRef = await validatorClient.appClient.getAppReference();
        // consoleLogger.info(`in addValidator, app id of validator contract is:${appid.appId}`)

        const vldtrAcct = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(500), suppressLog: true },
            fixture.context.algod,
            fixture.context.kmd
        );
        const validatorState = await validatorClient.appClient.getGlobalState();
        const nextValidator = (validatorState.numV.value as number) + 1;

        const config: ValidatorConfig = {
            PayoutEveryXDays: 1,
            PercentToValidator: 10000,
            ValidatorCommissionAddress: vldtrAcct,
            PoolsPerNode: 1,
            MaxNodes: 1,
        };

        let vldtrId: number;
        // Construct the validator pool
        try {
            vldtrId = Number(
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
                ).return!.valueOf()
            );
        } catch (exception) {
            console.log((exception as LogicError).message);
            throw exception;
        }

        try {
            // Now add a staking pool
            const PoolKey = (
                await validatorClient.addPool(
                    { validatorID: vldtrId },
                    {
                        sendParams: {
                            fee: AlgoAmount.MicroAlgos(2000)
                            // populateAppCallResources:true
                        },
                        apps: [tmplPoolAppID],
                        boxes: [
                            { appId: 0, name: getValidatorListBoxName(nextValidator) },
                            { appId: 0, name: '' }, // buy more i/o
                        ],
                        sender: vldtrAcct,

                    }
                )
            ).return!.values();
        } catch (exception) {
            console.log((exception as LogicError).message);
            throw exception;
        }
        const foo = 5;
        // consoleLogger.info(PoolKey)
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
