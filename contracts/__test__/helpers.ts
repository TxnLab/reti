import { Account, decodeAddress, encodeUint64, makePaymentTxnWithSuggestedParamsFromObject } from 'algosdk';
import { LogicError } from '@algorandfoundation/algokit-utils/types/logic-error';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { AlgorandTestAutomationContext } from '@algorandfoundation/algokit-utils/types/testing';
import { ValidatorRegistryClient } from '../contracts/clients/ValidatorRegistryClient';
import { consoleLogger } from "@algorandfoundation/algokit-utils/types/logging";

interface ValidatorConfig {
    PayoutEveryXDays?: number; // Payout frequency - ie: 7, 30, etc.
    PercentToValidator?: number; // Payout percentage expressed w/ four decimals - ie: 50000 = 5% -> .0005 -
    ValidatorCommissionAddress?: string; // account that receives the validation commission each epoch payout
    MinEntryStake?: number; // minimum stake required to enter pool
    MaxAlgoPerPool?: number; // maximum stake allowed per pool (to keep under incentive limits)
    PoolsPerNode?: number; // Number of pools to allow per node (max of 4 is recommended)
    MaxNodes?: number; // Maximum number of nodes the validator is stating they'll allow
}

const DefaultValidatorConfig: ValidatorConfig = {
    PayoutEveryXDays: 1,
    PercentToValidator: 10000, // 1.0000%
    ValidatorCommissionAddress: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
    MinEntryStake: AlgoAmount.Algos(1000).microAlgos,
    MaxAlgoPerPool: AlgoAmount.Algos(200_000).microAlgos,
    PoolsPerNode: 3,
    MaxNodes: 4,
};

export function createValidatorConfig(inputConfig: ValidatorConfig): ValidatorConfig {
    return {
        ...DefaultValidatorConfig,
        ...inputConfig,
    };
}

function validatorConfigAsArray(config: ValidatorConfig): [number, number, string, number, number, number, number] {
    return [
        config.PayoutEveryXDays!,
        config.PercentToValidator!,
        config.ValidatorCommissionAddress!,
        config.MinEntryStake!,
        config.MaxAlgoPerPool!,
        config.PoolsPerNode!,
        config.MaxNodes!,
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

export function getValidatorListBoxName(validatorID: number) {
    const prefix = new TextEncoder().encode('v');
    return concatUint8Arrays(prefix, encodeUint64(validatorID));
}

function getStakerPoolSetName(stakerAccount: Account) {
    const prefix = new TextEncoder().encode('sps');
    return concatUint8Arrays(prefix, decodeAddress(stakerAccount.addr).publicKey);
}

export async function getMbrAmountsFromValidatorClient(validatorClient: ValidatorRegistryClient) {
    return (await validatorClient.compose().getMbrAmounts({}, {}).simulate()).returns![0];
}

export async function addValidator(validatorClient: ValidatorRegistryClient, owner: Account, config: ValidatorConfig, validatorMbr: bigint) {
    // 'real' code will likely have to do this unless simulate is used..
    const nextValidator = (await validatorClient.getGlobalState()).numV!.asNumber() + 1;

    // Need MBR to cover box cost for new validator data
    await validatorClient.appClient.fundAppAccount(AlgoAmount.MicroAlgos(Number(validatorMbr)));

    try {
        return Number(
            (
                await validatorClient.addValidator(
                    {
                        owner: owner.addr,
                        manager: owner.addr,
                        nfdAppID: 0,
                        config: validatorConfigAsArray(config),
                    },
                    {
                        boxes: [
                            { appId: 0, name: getValidatorListBoxName(nextValidator) },
                            { appId: 0, name: '' }, // buy more i/o
                        ],
                        sendParams: {populateAppCallResources:true},
                    }
                )
            ).return!
        );
    } catch (e) {
        // throw validatorClient.appClient.exposeLogicError(e as Error)
        console.log((e as LogicError).message);
        throw e;
    }
}

export async function getValidatorState(validatorClient: ValidatorRegistryClient, validatorID: number) {
    return createValidatorCurStateFromValues(
        (
            await validatorClient
                .compose()
                .getValidatorState({ validatorID }, {})
                .simulate({ allowUnnamedResources: true })
        ).returns![0]
    );
}

export async function getPoolInfo(validatorClient: ValidatorRegistryClient, poolKey: [bigint, bigint, bigint]) {
    return createPoolInfoFromValues(
        (await validatorClient.compose().getPoolInfo({ poolKey }, {}).simulate({ allowUnnamedResources: true }))
            .returns![0]
    );
}

export async function addStakingPool(
    context: AlgorandTestAutomationContext,
    validatorClient: ValidatorRegistryClient,
    validatorID: number,
    vldtrAcct: Account,
    poolMbr: bigint
) {
    const suggestedParams = await context.algod.getTransactionParams().do();
    const validatorsAppRef = await validatorClient.appClient.getAppReference();

    // Pay the additional mbr to the validator contract for the new pool mbr
    const payPoolMbr = makePaymentTxnWithSuggestedParamsFromObject({
        from: context.testAccount.addr,
        to: validatorsAppRef.appAddress,
        amount: Number(poolMbr),
        suggestedParams,
    });

    // Before validator can add pools it needs to be funded
    try {
        // Now add a staking pool
        const results = await validatorClient
            .compose()
            .addPool(
                {
                    mbrPayment: { transaction: payPoolMbr, signer: context.testAccount },
                    validatorID,
                },
                {
                    sendParams: {
                        fee: AlgoAmount.MicroAlgos(2000),
                    },
                    sender: vldtrAcct,
                    // apps: [tmplPoolAppID], // needs to reference template to create new instance
                    // boxes: [
                    //     {appId: 0, name: getValidatorListBoxName(validatorID)},
                    //     {appId: 0, name: ''}, // buy more i/o
                    // ],
                }
            )
            .execute({ populateAppCallResources: true });
        return results.returns[0];
    } catch (exception) {
        console.log((exception as LogicError).message);
        throw exception;
    }
}

export async function addStake(
    context: AlgorandTestAutomationContext,
    validatorClient: ValidatorRegistryClient,
    vldtrId: number,
    staker: Account,
    algoAmount: AlgoAmount
) {
    try {
        const suggestedParams = await context.algod.getTransactionParams().do();
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
                    sender: staker,
                    // apps: [tmplPoolAppID],
                    // boxes: [
                    //     { appId: 0, name: getValidatorListBoxName(vldtrId) },
                    //     { appId: 0, name: '' }, // buy more i/o
                    //     { appId: 0, name: getStakerPoolSetName(staker) },
                    // ],
                }
            )
            .execute({ populateAppCallResources: true });
        return results.returns[1];
    } catch (exception) {
        throw validatorClient.appClient.exposeLogicError(exception as Error)
        // consoleLogger.warn((exception as LogicError).message);
        // throw exception;
    }
}
