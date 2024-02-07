import { afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import { algoKitLogCaptureFixture, algorandFixture, getTestAccount } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import {
    Account,
    decodeAddress,
    encodeUint64,
    getApplicationAddress,
    makePaymentTxnWithSuggestedParamsFromObject,
    SuggestedParams,
} from 'algosdk';
import { LogicError } from '@algorandfoundation/algokit-utils/types/logic-error';
import { StakingPoolClient } from '../contracts/clients/StakingPoolClient';
import { ValidatorRegistryClient } from '../contracts/clients/ValidatorRegistryClient';
// import { algoKitLogCaptureFixture } from '@algorandfoundation/algokit-utils/testing'

const fixture = algorandFixture();
const logs = algoKitLogCaptureFixture();

let validatorClient: ValidatorRegistryClient;
let poolClient: StakingPoolClient;

/** The suggested params for any manualtransactions */
let suggestedParams: SuggestedParams;

// app id of template app id
let tmplPoolAppID: number;

// algokit.Config.configure({ debug: true });

type ValidatorConfig = {
    PayoutEveryXDays: number; // Payout frequency - ie: 7, 30, etc.
    PercentToValidator: number; // Payout percentage expressed w/ four decimals - ie: 50000 = 5% -> .0005 -
    ValidatorCommissionAddress: Account; // account that receives the validation commission each epoch payout
    MinEntryStake: number; // minimum stake required to enter pool
    MaxAlgoPerPool: number; // maximum stake allowed per pool (to keep under incentive limits)
    PoolsPerNode: number; // Number of pools to allow per node (max of 4 is recommended)
    MaxNodes: number; // Maximum number of nodes the validator is stating they'll allow
};

function validatorConfigAsArray(config: ValidatorConfig): [number, number, string, number, number, number, number] {
    return [
        config.PayoutEveryXDays,
        config.PercentToValidator,
        config.ValidatorCommissionAddress.addr,
        config.MinEntryStake,
        config.MaxAlgoPerPool,
        config.PoolsPerNode,
        config.MaxNodes,
    ];
}

type ValidatorCurState = {
    NumPools: number; // current number of pools this validator has - capped at MaxPools
    TotalStakers: bigint; // total number of stakers across all pools
    TotalAlgoStaked: bigint; // total amount staked to this validator across ALL of its pools
};

function createValidatorCurStateFromValues([NumPools, TotalStakers, TotalAlgoStaked]: [
    number,
    bigint,
    bigint,
]): ValidatorCurState {
    return { NumPools, TotalStakers, TotalAlgoStaked };
}

type PoolInfo = {
    NodeID: number;
    PoolAppID: bigint; // The App ID of this staking pool contract instance
    TotalStakers: number;
    TotalAlgoStaked: bigint;
};

function createPoolInfoFromValues([NodeID, PoolAppID, TotalStakers, TotalAlgoStaked]: [
    number,
    bigint,
    number,
    bigint,
]): PoolInfo {
    return { NodeID, PoolAppID, TotalStakers, TotalAlgoStaked };
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

async function addValidator(config: ValidatorConfig, owner: Account, nextValidator: number) {
    try {
        return Number(
            (
                await validatorClient.addValidator(
                    {
                        config: validatorConfigAsArray(config),
                        manager: owner.addr,
                        owner: owner.addr,
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

async function getValidatorState(validatorID: number) {
    // const retVal = ;
    // if (retVal.simulateResponse.txnGroups[0].failureMessage !== undefined) {
    //     consoleLogger.error(retVal.simulateResponse.txnGroups[0].failureMessage);
    //     throw retVal.simulateResponse.txnGroups[0].failureMessage;
    // }
    return createValidatorCurStateFromValues(
        (
            await validatorClient
                .compose()
                .getValidatorState({ validatorID }, {})
                .simulate({ allowUnnamedResources: true })
        ).returns![0]
    );
}

async function getPoolInfo(poolKey: [bigint, bigint, bigint]) {
    return createPoolInfoFromValues(
        (await validatorClient.compose().getPoolInfo({ poolKey }, {}).simulate({ allowUnnamedResources: true }))
            .returns![0]
    );
}

async function getMbrAmountsFromValidatorClient() {
    return (await validatorClient.compose().getMbrAmounts({}, {}).simulate()).returns![0];
}

async function addStakingPool(validatorID: number, nextValidator: number, vldtrAcct: Account) {
    // Now get MBR amounts via simulate from the contract
    const mbrAmounts = await getMbrAmountsFromValidatorClient();
    const addPoolMbr = mbrAmounts[1];

    const validatorsAppRef = await validatorClient.appClient.getAppReference();
    // Pay the additional mbr to the validator contract for the new pool mbr
    const payPoolMbr = makePaymentTxnWithSuggestedParamsFromObject({
        from: fixture.context.testAccount.addr,
        to: validatorsAppRef.appAddress,
        amount: Number(addPoolMbr),
        suggestedParams,
    });

    // Before validator can add pools it needs to be funded
    try {
        // Now add a staking pool
        const results = await validatorClient
            .compose()
            .addPool(
                {
                    mbrPayment: { transaction: payPoolMbr, signer: fixture.context.testAccount },
                    validatorID,
                },
                {
                    sendParams: {
                        fee: AlgoAmount.MicroAlgos(2000),
                    },
                    apps: [tmplPoolAppID], // needsto reference template to create new instance
                    boxes: [
                        { appId: 0, name: getValidatorListBoxName(nextValidator) },
                        { appId: 0, name: '' }, // buy more i/o
                    ],
                    sender: vldtrAcct,
                }
            )
            .execute();
        return results.returns[0];
    } catch (exception) {
        console.log((exception as LogicError).message);
        throw exception;
    }
}

async function addStake(vldtrId: number, staker: Account, algoAmount: AlgoAmount) {
    try {
        const validatorsAppRef = await validatorClient.appClient.getAppReference();

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
            to: validatorsAppRef.appAddress,
            amount: algoAmount.microAlgos,
            suggestedParams,
        });
        const results = await validatorClient
            .compose()
            .gas(
                {},
                {
                    apps: [Number(poolAppId)],
                    boxes: [
                        { appId: Number(poolAppId), name: new TextEncoder().encode('stakers') },
                        { appId: Number(poolAppId), name: '' },
                        { appId: Number(poolAppId), name: '' },
                        { appId: Number(poolAppId), name: '' },
                        { appId: Number(poolAppId), name: '' },
                        { appId: Number(poolAppId), name: '' },
                    ],
                }
            )
            .addStake(
                // This the actual send of stake to the ac
                {
                    stakedAmountPayment: { transaction: stakeTransfer, signer: staker },
                    validatorID: vldtrId,
                },
                {
                    sendParams: {
                        fee: AlgoAmount.MicroAlgos(5000),
                    },
                    apps: [tmplPoolAppID],
                    boxes: [
                        { appId: 0, name: getValidatorListBoxName(vldtrId) },
                        { appId: 0, name: '' }, // buy more i/o
                        { appId: 0, name: getStakerPoolSetName(staker) },
                    ],
                    sender: staker,
                }
            )
            .execute();
        return results.returns[1];
    } catch (exception) {
        console.log((exception as LogicError).message);
        throw exception;
    }
}

describe('ValidatorRegistry', () => {
    beforeEach(fixture.beforeEach);
    beforeEach(logs.beforeEach);
    afterEach(logs.afterEach);

    // let perPoolMbr: bigint;

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
        const validatorState = await validatorClient.appClient.getGlobalState();
        const expectedNextValidatorID = (validatorState.numV.value as number) + 1;

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
        const mbrAmounts = await getMbrAmountsFromValidatorClient();
        const addValidatorMbr = mbrAmounts[0];

        // Before validator can add pools it needs to be funded
        await validatorClient.appClient.fundAppAccount(AlgoAmount.MicroAlgos(Number(addValidatorMbr)));
        // Construct the validator pool itself !
        const validatorID = await addValidator(config, validatorOwnerAccount, expectedNextValidatorID);

        // Now add a pool - we have to include payment for its MBR as well
        const poolKey = await addStakingPool(validatorID, expectedNextValidatorID, validatorOwnerAccount);
        // should be [validator id, pool id (1 based)]
        expect(poolKey[0]).toBe(BigInt(validatorID));
        expect(poolKey[1]).toBe(BigInt(1));

        // get the app id of the specified validator/pool, so we can compare against the internal box state changes.
        const poolAppId = (
            await validatorClient.getPoolAppId({ poolKey }, { sendParams: { populateAppCallResources: true } })
        ).return!;
        expect(poolKey[2]).toBe(poolAppId);

        const newBoxData = await validatorClient.appClient.getBoxValue(getValidatorListBoxName(validatorID));

        const stateData = await getValidatorState(validatorID);
        expect(stateData.NumPools).toEqual(BigInt(1));
        expect(stateData.TotalAlgoStaked).toEqual(BigInt(0));
        expect(stateData.TotalStakers).toEqual(BigInt(0));

        const poolInfo = await getPoolInfo(poolKey);
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

        const mbrs = await getMbrAmountsFromValidatorClient();
        const stakerMbr = mbrs[2];

        let stakeAmount = AlgoAmount.Algos(900);
        const stakedPoolKey = await addStake(validatorID, stakerAccount, stakeAmount);
        // should be same as what we added prior
        expect(stakedPoolKey[0]).toBe(poolKey[0]);
        expect(stakedPoolKey[1]).toBe(poolKey[1]);
        expect(stakedPoolKey[2]).toBe(poolKey[2]);

        const stakePt1Balance = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do();
        expect(stakePt1Balance.amount).toBe(origStakePoolInfo.amount + stakeAmount.microAlgos - Number(stakerMbr));

        // stake again for 1000 more - should go to same pool.
        stakeAmount = AlgoAmount.Algos(1000);
        const stakedKey2 = await addStake(validatorID, stakerAccount, stakeAmount);
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
