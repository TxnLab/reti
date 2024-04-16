import {
    Account,
    Address,
    Algodv2,
    bytesToBigInt,
    decodeAddress,
    encodeAddress,
    encodeUint64,
    getApplicationAddress,
    makeAssetCreateTxnWithSuggestedParamsFromObject,
    makePaymentTxnWithSuggestedParamsFromObject,
} from 'algosdk';
import { LogicError } from '@algorandfoundation/algokit-utils/types/logic-error';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { AlgorandTestAutomationContext } from '@algorandfoundation/algokit-utils/types/testing';
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging';
import { expect } from '@jest/globals';
import { ValidatorRegistryClient } from '../contracts/clients/ValidatorRegistryClient';
import { StakingPoolClient } from '../contracts/clients/StakingPoolClient';

export const ALGORAND_ZERO_ADDRESS_STRING = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';

export const GATING_TYPE_NONE = 0;
export const GATING_TYPE_ASSETS_CREATED_BY = 1;
export const GATING_TYPE_ASSET_ID = 2;
export const GATING_TYPE_CREATED_BY_NFD_ADDRESSES = 3;
export const GATING_TYPE_SEGMENT_OF_NFD = 4;

export class ValidatorConfig {
    ID: bigint; // id of this validator (sequentially assigned)

    Owner: string; // account that controls config - presumably cold-wallet

    Manager: string; // account that triggers/pays for payouts and keyreg transactions - needs to be hotwallet as node has to sign for the transactions

    // Optional NFD AppID which the validator uses to describe their validator pool
    // NFD must be currently OWNED by address that adds the validator
    NFDForInfo: bigint;

    EntryGatingType: number;

    EntryGatingAddress: string;

    EntryGatingAssets: [bigint, bigint, bigint, bigint];

    GatingAssetMinBalance: bigint;

    RewardTokenID: bigint;

    RewardPerPayout: bigint;

    PayoutEveryXMins: number; // // Payout frequency in minutes (can be no shorter than this)

    PercentToValidator: number; // Payout percentage expressed w/ four decimals - ie: 50000 = 5% -> .0005 -

    ValidatorCommissionAddress: string; // account that receives the validation commission each epoch payout

    MinEntryStake: bigint; // minimum stake required to enter pool

    MaxAlgoPerPool: bigint; // maximum stake allowed per pool (to keep under incentive limits)

    PoolsPerNode: number; // Number of pools to allow per node (max of 3 is recommended)

    SunsettingOn: bigint; // timestamp when validator will sunset (if != 0)

    SunsettingTo: bigint; // validator id that validator is 'moving' to (if known)

    // getValidatorConfig(uint64)(uint64,address,address,uint64,uint16,uint32,address,uint64,uint64,uint8)
    // constructor to take array of values like ABI string above and set into the named instance vars
    constructor([
        ID,
        Owner,
        Manager,
        NFDForInfo,
        EntryGatingType,
        EntryGatingAddress,
        EntryGatingAssets,
        GatingAssetMinBalance,
        RewardTokenID,
        RewardPerPayout,
        PayoutEveryXMins,
        PercentToValidator,
        ValidatorCommissionAddress,
        MinEntryStake,
        MaxAlgoPerPool,
        PoolsPerNode,
        SunsettingOn,
        SunsettingTo,
    ]: [
        bigint,
        string,
        string,
        bigint,
        number,
        string,
        [bigint, bigint, bigint, bigint],
        bigint,
        bigint,
        bigint,
        number,
        number,
        string,
        bigint,
        bigint,
        number,
        bigint,
        bigint,
    ]) {
        this.ID = ID;
        this.Owner = Owner;
        this.Manager = Manager;
        this.NFDForInfo = NFDForInfo;
        this.EntryGatingType = Number(EntryGatingType);
        this.EntryGatingAddress = EntryGatingAddress;
        this.EntryGatingAssets = EntryGatingAssets;
        this.GatingAssetMinBalance = GatingAssetMinBalance;
        this.RewardTokenID = RewardTokenID;
        this.RewardPerPayout = RewardPerPayout;
        this.PayoutEveryXMins = Number(PayoutEveryXMins);
        this.PercentToValidator = Number(PercentToValidator);
        this.ValidatorCommissionAddress = ValidatorCommissionAddress;
        this.MinEntryStake = MinEntryStake;
        this.MaxAlgoPerPool = MaxAlgoPerPool;
        this.PoolsPerNode = Number(PoolsPerNode);
        this.SunsettingOn = SunsettingOn;
        this.SunsettingTo = SunsettingTo;
    }
}

const DefaultValidatorConfig: ValidatorConfig = {
    ID: BigInt(0),
    Owner: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
    Manager: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
    NFDForInfo: 0n,
    EntryGatingType: GATING_TYPE_NONE,
    EntryGatingAddress: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
    EntryGatingAssets: [0n, 0n, 0n, 0n],
    GatingAssetMinBalance: 0n,
    RewardTokenID: 0n,
    RewardPerPayout: 0n,
    PayoutEveryXMins: 60 * 24, // daily payout
    PercentToValidator: 10000, // 1.0000%
    ValidatorCommissionAddress: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
    MinEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
    MaxAlgoPerPool: 0n, // float w/ online caps
    PoolsPerNode: 3,
    SunsettingOn: 0n,
    SunsettingTo: 0n,
};

export function createValidatorConfig(inputConfig: Partial<ValidatorConfig>): ValidatorConfig {
    const configObj = {
        ...DefaultValidatorConfig,
        ...inputConfig,
    };

    return new ValidatorConfig([
        configObj.ID,
        configObj.Owner,
        configObj.Manager,
        configObj.NFDForInfo,
        configObj.EntryGatingType,
        configObj.EntryGatingAddress,
        configObj.EntryGatingAssets,
        configObj.GatingAssetMinBalance,
        configObj.RewardTokenID,
        configObj.RewardPerPayout,
        configObj.PayoutEveryXMins,
        configObj.PercentToValidator,
        configObj.ValidatorCommissionAddress,
        configObj.MinEntryStake,
        configObj.MaxAlgoPerPool,
        configObj.PoolsPerNode,
        configObj.SunsettingOn,
        configObj.SunsettingTo,
    ]);
}

function validatorConfigAsArray(
    config: ValidatorConfig
): [
    bigint,
    string,
    string,
    bigint,
    number,
    string,
    [bigint, bigint, bigint, bigint],
    bigint,
    bigint,
    bigint,
    number,
    number,
    string,
    bigint,
    bigint,
    number,
    bigint,
    bigint,
] {
    return [
        config.ID,
        config.Owner,
        config.Manager,
        config.NFDForInfo,
        config.EntryGatingType,
        config.EntryGatingAddress,
        config.EntryGatingAssets,
        config.GatingAssetMinBalance,
        config.RewardTokenID,
        config.RewardPerPayout,
        config.PayoutEveryXMins,
        config.PercentToValidator,
        config.ValidatorCommissionAddress,
        config.MinEntryStake,
        config.MaxAlgoPerPool,
        config.PoolsPerNode,
        config.SunsettingOn,
        config.SunsettingTo,
    ];
}

class ValidatorCurState {
    numPools: number; // current number of pools this validator has - capped at MaxPools

    totalStakers: bigint; // total number of stakers across all pools

    totalAlgoStaked: bigint; // total amount staked to this validator across ALL of its pools

    rewardTokenHeldBack: bigint; // amount of token held back for future payout to stakers

    constructor([numPools, totalStakers, totalAlgoStaked, rewardTokenHeldBack]: [number, bigint, bigint, bigint]) {
        this.numPools = Number(numPools);
        this.totalStakers = totalStakers;
        this.totalAlgoStaked = totalAlgoStaked;
        this.rewardTokenHeldBack = rewardTokenHeldBack;
    }
}

export class PoolInfo {
    poolAppId: bigint; // The App id of this staking pool contract instance

    totalStakers: number;

    totalAlgoStaked: bigint;

    constructor([poolAppId, totalStakers, totalAlgoStaked]: [bigint, number, bigint]) {
        this.poolAppId = poolAppId;
        this.totalStakers = Number(totalStakers);
        this.totalAlgoStaked = totalAlgoStaked;
    }
}

export class ValidatorPoolKey {
    id: bigint;

    poolId: bigint; // 0 means INVALID ! - so 1 is index, technically of [0]

    poolAppId: bigint;

    constructor([id, poolId, poolAppId]: [bigint, bigint, bigint]) {
        this.id = id;
        this.poolId = poolId;
        this.poolAppId = poolAppId;
    }

    encode(): [bigint, bigint, bigint] {
        return [this.id, this.poolId, this.poolAppId];
    }
}

// StakedInfo is the testing-friendly version of what's stored as a static array in each staking pool
export class StakedInfo {
    staker: Address;

    balance: bigint;

    totalRewarded: bigint;

    rewardTokenBalance: bigint;

    entryTime: bigint;

    constructor(data: Uint8Array) {
        this.staker = decodeAddress(encodeAddress(data.slice(0, 32)));
        this.balance = bytesToBigInt(data.slice(32, 40));
        this.totalRewarded = bytesToBigInt(data.slice(40, 48));
        this.rewardTokenBalance = bytesToBigInt(data.slice(48, 56));
        this.entryTime = bytesToBigInt(data.slice(56, 64));
    }

    public static fromValues([Staker, Balance, TotalRewarded, RewardTokenBalance, EntryTime]: [
        string,
        bigint,
        bigint,
        bigint,
        bigint,
    ]): StakedInfo {
        return {
            staker: decodeAddress(Staker),
            balance: Balance,
            totalRewarded: TotalRewarded,
            rewardTokenBalance: RewardTokenBalance,
            entryTime: EntryTime,
        };
    }

    public static FromBoxData(boxData: Uint8Array): StakedInfo[] {
        // take 64-byte chunks of boxData and return as an array of StakedInfo values (initialized via its constructor
        // which takes 64-byte chunks and returns an initialized StakedInfo
        const chunkSize = 64;
        const stakedInfoArray: StakedInfo[] = [];
        for (let i = 0; i < boxData.length; i += chunkSize) {
            const chunk = boxData.slice(i, i + chunkSize);
            stakedInfoArray.push(new StakedInfo(chunk));
        }
        return stakedInfoArray;
    }
}

// ProtocolConstraints returns data from the contracts on minimums, maximums, etc.
export class ProtocolConstraints {
    EpochPayoutMinsMin: bigint;

    EpochPayoutMinsMax: bigint;

    MinPctToValidatorWFourDecimals: bigint;

    MaxPctToValidatorWFourDecimals: bigint;

    MinEntryStake: bigint; // in microAlgo

    MaxAlgoPerPool: bigint; // in microAlgo

    MaxAlgoPerValidator: bigint; // in microAlgo

    AmtConsideredSaturated: bigint;

    MaxNodes: bigint;

    MaxPoolsPerNode: bigint;

    MaxStakersPerPool: bigint;

    constructor([
        EpochPayoutMinsMin,
        EpochPayoutMinsMax,
        MinPctToValidatorWFourDecimals,
        MaxPctToValidatorWFourDecimals,
        MinEntryStake,
        MaxAlgoPerPool,
        MaxAlgoPerValidator,
        AmtConsideredSaturated,
        MaxNodes,
        MaxPoolsPerNode,
        MaxStakersPerPool,
    ]: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]) {
        this.EpochPayoutMinsMin = EpochPayoutMinsMin;
        this.EpochPayoutMinsMax = EpochPayoutMinsMax;
        this.MinPctToValidatorWFourDecimals = MinPctToValidatorWFourDecimals;
        this.MaxPctToValidatorWFourDecimals = MaxPctToValidatorWFourDecimals;
        this.MinEntryStake = MinEntryStake;
        this.MaxAlgoPerPool = MaxAlgoPerPool;
        this.MaxAlgoPerValidator = MaxAlgoPerValidator;
        this.AmtConsideredSaturated = AmtConsideredSaturated;
        this.MaxNodes = MaxNodes;
        this.MaxPoolsPerNode = MaxPoolsPerNode;
        this.MaxStakersPerPool = MaxStakersPerPool;
    }

    public static fromValues([
        EpochPayoutMinsMin,
        EpochPayoutMinsMax,
        MinPctToValidatorWFourDecimals,
        MaxPctToValidatorWFourDecimals,
        MinEntryStake,
        MaxAlgoPerPool,
        MaxAlgoPerValidator,
        AmtConsideredSaturated,
        MaxNodes,
        MaxPoolsPerNode,
        MaxStakersPerPool,
    ]: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]): ProtocolConstraints {
        return {
            EpochPayoutMinsMin,
            EpochPayoutMinsMax,
            MinPctToValidatorWFourDecimals,
            MaxPctToValidatorWFourDecimals,
            MinEntryStake,
            MaxAlgoPerPool,
            MaxAlgoPerValidator,
            AmtConsideredSaturated,
            MaxNodes,
            MaxPoolsPerNode,
            MaxStakersPerPool,
        };
    }
}

class PoolTokenPayoutRatio {
    PoolPctOfWhole: bigint[];

    UpdatedForPayout: bigint;

    constructor([PoolPctOfWhole, UpdatedForPayout]: [bigint[], bigint]) {
        this.PoolPctOfWhole = PoolPctOfWhole;
        this.UpdatedForPayout = UpdatedForPayout;
    }
}

function concatUint8Arrays(a: Uint8Array, b: Uint8Array): Uint8Array {
    const result = new Uint8Array(a.length + b.length);
    result.set(a);
    result.set(b, a.length);
    return result;
}

export async function getStakeInfoFromBoxValue(stakeClient: StakingPoolClient) {
    const stakerData = await stakeClient.appClient.getBoxValue('stakers');
    return StakedInfo.FromBoxData(stakerData);
}

export function getValidatorListBoxName(validatorId: number) {
    const prefix = new TextEncoder().encode('v');
    return concatUint8Arrays(prefix, encodeUint64(validatorId));
}

// function getStakerPoolSetBoxName(stakerAccount: Account) {
//     const prefix = new TextEncoder().encode('sps');
//     return concatUint8Arrays(prefix, decodeAddress(stakerAccount.addr).publicKey);
// }

// function getStakersBoxName() {
//     return new TextEncoder().encode('stakers');
// }

export async function getMbrAmountsFromValidatorClient(validatorClient: ValidatorRegistryClient) {
    return (await validatorClient.compose().getMbrAmounts({}, {}).simulate()).returns![0];
}

export async function getProtocolConstraints(validatorClient: ValidatorRegistryClient) {
    return new ProtocolConstraints(
        (await validatorClient.compose().getProtocolConstraints({}, {}).simulate()).returns![0]
    );
}

function dumpLogs(logs: Uint8Array[]) {
    consoleLogger.info(logs.map((uint8array) => new TextDecoder().decode(uint8array)).join('\n'));
}

export async function addValidator(
    context: AlgorandTestAutomationContext,
    validatorClient: ValidatorRegistryClient,
    owner: Account,
    config: ValidatorConfig,
    validatorMbr: bigint
) {
    const suggestedParams = await context.algod.getTransactionParams().do();
    const validatorsAppRef = await validatorClient.appClient.getAppReference();

    // Pay the additional mbr to the validator contract for the new validator mbr
    const payValidatorMbr = makePaymentTxnWithSuggestedParamsFromObject({
        from: context.testAccount.addr,
        to: validatorsAppRef.appAddress,
        amount: Number(validatorMbr),
        suggestedParams,
    });

    try {
        const results = await validatorClient
            .compose()
            .addValidator(
                {
                    // the required MBR payment transaction..
                    mbrPayment: { transaction: payValidatorMbr, signer: context.testAccount },
                    // --
                    nfdName: '',
                    config: validatorConfigAsArray(config),
                },
                {
                    sender: owner,
                }
            )
            .execute({ populateAppCallResources: true });
        return Number(results.returns![0]);
    } catch (e) {
        // throw validatorClient.appClient.exposeLogicError(e as Error)
        consoleLogger.warn((e as LogicError).message);
        throw e;
    }
}

export async function getValidatorState(validatorClient: ValidatorRegistryClient, validatorId: number) {
    return new ValidatorCurState(
        (
            await validatorClient
                .compose()
                .getValidatorState({ validatorId }, {})
                .simulate({ allowUnnamedResources: true })
        ).returns![0]
    );
}

export async function addStakingPool(
    context: AlgorandTestAutomationContext,
    validatorClient: ValidatorRegistryClient,
    validatorId: number,
    nodeNum: number,
    vldtrAcct: Account,
    poolMbr: bigint,
    poolInitMbr: bigint
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let addPoolResults: any;
    // Before validator can add pools it needs to be funded
    try {
        // Now add a staking pool
        addPoolResults = await validatorClient
            .compose()
            .gas({}, { note: '1' })
            .gas({}, { note: '2' })
            .addPool(
                {
                    mbrPayment: { transaction: payPoolMbr, signer: context.testAccount },
                    validatorId,
                    nodeNum,
                },
                {
                    sendParams: {
                        fee: AlgoAmount.MicroAlgos(2000),
                    },
                    sender: vldtrAcct,
                }
            )
            .execute({ populateAppCallResources: true });
    } catch (exception) {
        console.log((exception as LogicError).message);
        throw exception;
    }
    const poolKey = new ValidatorPoolKey(addPoolResults.returns![2]);

    // Pay the mbr to the newly created staking pool contract to cover its upcoming box mbr storage req
    const payStakingPoolMbr = makePaymentTxnWithSuggestedParamsFromObject({
        from: context.testAccount.addr,
        to: getApplicationAddress(poolKey.poolAppId),
        amount: Number(poolInitMbr),
        suggestedParams,
    });

    // now tell it to initialize its storage (w/ our mbr payment)
    const newPoolClient = new StakingPoolClient(
        { sender: vldtrAcct, resolveBy: 'id', id: poolKey.poolAppId },
        context.algod
    );

    await newPoolClient
        .compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .initStorage(
            {
                // the required MBR payment transaction
                mbrPayment: { transaction: payStakingPoolMbr, signer: context.testAccount },
            },
            {
                sendParams: {
                    fee: AlgoAmount.MicroAlgos(3000),
                },
            }
        )
        .execute({ populateAppCallResources: true });

    return poolKey;
}

export async function getPoolInfo(validatorClient: ValidatorRegistryClient, poolKey: ValidatorPoolKey) {
    try {
        const PoolRet = await validatorClient
            .compose()
            .getPoolInfo({ poolKey: poolKey.encode() }, {})
            .simulate({ allowUnnamedResources: true });
        return new PoolInfo(PoolRet.returns![0]);
    } catch (exception) {
        console.log((exception as LogicError).message);
        throw validatorClient.appClient.exposeLogicError(exception as Error);
        // throw exception;
    }
}

export async function getCurMaxStatePerPool(validatorClient: ValidatorRegistryClient, validatorId: number) {
    try {
        return (
            await validatorClient
                .compose()
                .getCurMaxStakePerPool({ validatorId })
                .simulate({ allowUnnamedResources: true })
        ).returns![0];
    } catch (exception) {
        console.log((exception as LogicError).message);
        throw validatorClient.appClient.exposeLogicError(exception as Error);
    }
}

export async function getStakedPoolsForAccount(
    validatorClient: ValidatorRegistryClient,
    stakerAccount: Account
): Promise<ValidatorPoolKey[]> {
    const results = await validatorClient.getStakedPoolsForAccount(
        { staker: stakerAccount.addr },
        { sendParams: { populateAppCallResources: true } }
    );
    const retPoolKeys: ValidatorPoolKey[] = [];
    results.return!.forEach((poolKey) => {
        retPoolKeys.push(new ValidatorPoolKey(poolKey));
    });
    return retPoolKeys;
}

export async function getStakerInfo(stakeClient: StakingPoolClient, staker: Account) {
    try {
        return StakedInfo.fromValues(
            (
                await stakeClient
                    .compose()
                    .getStakerInfo({ staker: staker.addr }, {})
                    .simulate({ allowUnnamedResources: true })
            ).returns![0]
        );
    } catch (exception) {
        console.log((exception as LogicError).message);
        throw stakeClient.appClient.exposeLogicError(exception as Error);
        // throw exception;
    }
}

export async function getTokenPayoutRatio(validatorClient: ValidatorRegistryClient, validatorId: number) {
    return new PoolTokenPayoutRatio(
        (
            await validatorClient
                .compose()
                .getTokenPayoutRatio({ validatorId }, {})
                .simulate({ allowUnnamedResources: true })
        ).returns![0]
    );
}

export async function addStake(
    context: AlgorandTestAutomationContext,
    validatorClient: ValidatorRegistryClient,
    vldtrId: number,
    staker: Account,
    algoAmount: AlgoAmount,
    valueToVerify: bigint // depends on gating but could be nfd id, or asset id
): Promise<[ValidatorPoolKey, AlgoAmount]> {
    try {
        const suggestedParams = await context.algod.getTransactionParams().do();
        const validatorsAppRef = await validatorClient.appClient.getAppReference();

        suggestedParams.flatFee = true;
        suggestedParams.fee = 0;

        const findPoolSim = await validatorClient
            .compose()
            .gas({})
            .findPoolForStaker(
                { validatorId: vldtrId, staker: staker.addr, amountToStake: algoAmount.microAlgos },
                {
                    sendParams: {
                        fee: AlgoAmount.MicroAlgos(2000),
                    },
                }
            )
            .simulate({ allowUnnamedResources: true });
        if (findPoolSim.simulateResponse.txnGroups[0].failureMessage !== undefined) {
            consoleLogger.error(
                `simulate failed in findPoolForStaker: ${findPoolSim.simulateResponse.txnGroups[0].failureMessage}`
            );
        }
        const expectedPool = findPoolSim.returns![1];

        const poolKey = new ValidatorPoolKey(expectedPool[0]);
        const willBeNewStaker = expectedPool[1];

        consoleLogger.info(
            `addStake findPool will add to validator:${poolKey.id}, pool:${poolKey.poolId} and willBeNew:${willBeNewStaker}`
        );

        // Pay the stake to the validator contract
        const stakeTransfer = makePaymentTxnWithSuggestedParamsFromObject({
            from: staker.addr,
            to: validatorsAppRef.appAddress,
            amount: algoAmount.microAlgos,
            suggestedParams,
        });

        // simulate to get fees
        let fees = AlgoAmount.MicroAlgos(240_000);
        const simulateResults = await validatorClient
            .compose()
            .gas({})
            .addStake(
                // This the actual send of stake to the ac
                {
                    stakedAmountPayment: { transaction: stakeTransfer, signer: staker },
                    validatorId: vldtrId,
                    valueToVerify,
                },
                { sendParams: { fee: fees }, sender: staker }
            )
            .simulate({ allowUnnamedResources: true, allowMoreLogging: true });

        const { logs } = simulateResults.simulateResponse.txnGroups[0].txnResults[2].txnResult;
        // verify logs isn't undefined
        if (logs !== undefined) {
            dumpLogs(logs);
        }
        stakeTransfer.group = undefined;
        fees = AlgoAmount.MicroAlgos(
            2000 +
                1000 *
                    Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700)
        );
        consoleLogger.info(`addStake fees:${fees.toString()}`);

        const results = await validatorClient
            .compose()
            .gas({}, { sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
            .addStake(
                {
                    // --
                    // This the actual send of stake to the validator contract (which then sends to the staking pool)
                    stakedAmountPayment: { transaction: stakeTransfer, signer: staker },
                    // --
                    validatorId: vldtrId,
                    valueToVerify,
                },
                { sendParams: { fee: fees }, sender: staker }
            )
            .execute({ populateAppCallResources: true });

        return [new ValidatorPoolKey(results.returns[1]), fees];
    } catch (exception) {
        consoleLogger.warn((exception as LogicError).message);
        // throw validatorClient.appClient.exposeLogicError(exception as Error);
        throw exception;
    }
}

export async function removeStake(stakeClient: StakingPoolClient, staker: Account, unstakeAmount: AlgoAmount) {
    const simulateResults = await stakeClient
        .compose()
        .gas({}, { note: '1', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
        .gas({}, { note: '2', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
        .removeStake(
            { amountToUnstake: unstakeAmount.microAlgos },
            {
                sendParams: {
                    fee: AlgoAmount.MicroAlgos(240000),
                },
                sender: staker,
            }
        )
        .simulate({ allowUnnamedResources: true });

    const itxnfees = AlgoAmount.MicroAlgos(
        1000 * Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700)
    );
    consoleLogger.info(`removeStake fees:${itxnfees.toString()}`);

    try {
        await stakeClient
            .compose()
            .gas({}, { note: '1', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
            .gas({}, { note: '2', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
            .removeStake(
                { amountToUnstake: unstakeAmount.microAlgos },
                {
                    sendParams: {
                        // pays us back and tells validator about balance changed
                        fee: AlgoAmount.MicroAlgos(itxnfees.microAlgos),
                    },
                    sender: staker,
                }
            )
            .execute({ populateAppCallResources: true });
    } catch (exception) {
        consoleLogger.warn((exception as LogicError).message);
        // throw stakeClient.appClient.exposeLogicError(exception as Error);
        throw exception;
    }
    return itxnfees.microAlgos;
}

export async function claimTokens(stakeClient: StakingPoolClient, staker: Account) {
    const simulateResults = await stakeClient
        .compose()
        .gas({}, { note: '1', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
        .gas({}, { note: '2', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
        .claimTokens(
            {},
            {
                sendParams: {
                    fee: AlgoAmount.MicroAlgos(240000),
                },
                sender: staker,
            }
        )
        .simulate({ allowUnnamedResources: true });

    const itxnfees = AlgoAmount.MicroAlgos(
        1000 * Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700)
    );
    consoleLogger.info(`removeStake fees:${itxnfees.toString()}`);

    try {
        await stakeClient
            .compose()
            .gas({}, { note: '1', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
            .gas({}, { note: '2', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
            .claimTokens(
                {},
                {
                    sendParams: {
                        // pays us back and tells validator about balance changed
                        fee: AlgoAmount.MicroAlgos(itxnfees.microAlgos),
                    },
                    sender: staker,
                }
            )
            .execute({ populateAppCallResources: true });
    } catch (exception) {
        consoleLogger.warn((exception as LogicError).message);
        // throw stakeClient.appClient.exposeLogicError(exception as Error);
        throw exception;
    }
    return itxnfees.microAlgos;
}

export async function epochBalanceUpdate(stakeClient: StakingPoolClient) {
    let fees = AlgoAmount.MicroAlgos(240_000);
    const simulateResults = await stakeClient
        .compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .epochBalanceUpdate({}, { sendParams: { fee: fees } })
        .simulate({ allowUnnamedResources: true, allowMoreLogging: true });

    const { logs } = await simulateResults.simulateResponse.txnGroups[0].txnResults[2].txnResult;
    // verify logs isn't undefined
    if (logs !== undefined) {
        dumpLogs(logs);
    }
    fees = AlgoAmount.MicroAlgos(
        1000 * Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700)
    );
    consoleLogger.info(`epoch update fees of:${fees.toString()}`);

    await stakeClient
        .compose()
        .gas({}, { note: '1', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
        .gas({}, { note: '2', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
        .epochBalanceUpdate({}, { sendParams: { fee: fees } })
        .execute({ populateAppCallResources: true });
    return fees;
}

export async function logStakingPoolInfo(
    context: AlgorandTestAutomationContext,
    PoolAppID: bigint,
    msgToDisplay: string
) {
    const firstPoolClient = new StakingPoolClient(
        { sender: context.testAccount, resolveBy: 'id', id: PoolAppID },
        context.algod
    );
    const stakingPoolGS = await firstPoolClient.appClient.getGlobalState();
    let lastPayoutTime: Date = new Date();
    if (stakingPoolGS.lastPayout !== undefined) {
        lastPayoutTime = new Date(Number(stakingPoolGS.lastPayout.value as bigint) * 1000);
    }

    const stakers = await getStakeInfoFromBoxValue(firstPoolClient);
    // iterate stakers displaying the info
    consoleLogger.info(`${msgToDisplay}, last Payout: ${lastPayoutTime.toUTCString()}`);
    for (let i = 0; i < stakers.length; i += 1) {
        if (encodeAddress(stakers[i].staker.publicKey) !== ALGORAND_ZERO_ADDRESS_STRING) {
            const entryTime = new Date(Number(stakers[i].entryTime) * 1000);
            consoleLogger.info(
                `${i}: Staker:${encodeAddress(stakers[i].staker.publicKey)}, Balance:${stakers[i].balance}, Rwd Tokens:${stakers[i].rewardTokenBalance} Entry:${entryTime.toUTCString()}`
            );
        }
    }
}

export async function verifyRewardAmounts(
    context: AlgorandTestAutomationContext,
    algoRewardedAmount: bigint,
    tokenRewardedAmount: bigint,
    stakersPriorToReward: StakedInfo[],
    stakersAfterReward: StakedInfo[],
    payoutEveryXMins: number
): Promise<void> {
    const payoutDaysInSecs = payoutEveryXMins * 24 * 60 * 60;
    // iterate stakersPriorToReward and total the 'balance' value to get a 'total amount'
    // then determine if the stakersAfterReward version's balance incremented in accordance w/ their percentage of
    // the 'total' - where they get that percentage of the rewardedAmount.
    const totalAmount = stakersPriorToReward.reduce((total, staker) => BigInt(total) + staker.balance, BigInt(0));

    // Figure out the timestamp of prior block and use that as the 'current time' for purposes
    // of matching the epoch payout calculations in the contract
    const curStatus = await context.algod.status().do();
    const lastBlock = await context.algod.block(curStatus['last-round'] - 1).do();
    const payoutTimeToUse = new Date(lastBlock.block.ts * 1000);

    consoleLogger.info(
        `verifyRewardAmounts checking ${stakersPriorToReward.length} stakers.  reward:${algoRewardedAmount}, totalAmount:${totalAmount}, payout time to use:${payoutTimeToUse.toString()}`
    );
    // Iterate all stakers - determine which haven't been for entire epoch - pay them proportionally less for having
    // less time in pool.  We keep track of their stake and then will later reduce the effective 'total staked' amount
    // by that so that the remaining stakers get the remaining reward + excess based on their % of stake against
    // remaining participants.
    let partialStakeAmount: bigint = BigInt(0);
    let algoRewardsAvail: bigint = algoRewardedAmount;
    let tokenRewardsAvail: bigint = tokenRewardedAmount;

    for (let i = 0; i < stakersPriorToReward.length; i += 1) {
        if (encodeAddress(stakersPriorToReward[i].staker.publicKey) === ALGORAND_ZERO_ADDRESS_STRING) {
            continue;
        }
        const stakerEntryTime = new Date(Number(stakersPriorToReward[i].entryTime) * 1000);
        if (stakerEntryTime.getTime() >= payoutTimeToUse.getTime()) {
            continue;
        }
        const origBalance = stakersPriorToReward[i].balance;
        const origRwdTokenBal = stakersPriorToReward[i].rewardTokenBalance;
        const timeInPoolSecs: bigint =
            (BigInt(payoutTimeToUse.getTime()) - BigInt(stakerEntryTime.getTime())) / BigInt(1000);
        const timePercentage: bigint = (BigInt(timeInPoolSecs) * BigInt(1000)) / BigInt(payoutDaysInSecs); // 34.7% becomes 347
        if (timePercentage < BigInt(1000)) {
            // partial staker
            const expectedReward =
                (BigInt(origBalance) * algoRewardedAmount * BigInt(timePercentage)) / (totalAmount * BigInt(1000));
            consoleLogger.info(
                `staker:${i}, TimePct:${timePercentage}, PctTotal:${Number((origBalance * BigInt(1000)) / totalAmount) / 10} ExpReward:${expectedReward}, ActReward:${stakersAfterReward[i].balance - origBalance} ${encodeAddress(stakersPriorToReward[i].staker.publicKey)}`
            );

            if (origBalance + expectedReward !== stakersAfterReward[i].balance) {
                consoleLogger.warn(
                    `staker:${i} expected: ${origBalance + expectedReward} reward but got: ${stakersAfterReward[i].balance}`
                );
                expect(stakersAfterReward[i].balance).toBe(origBalance + expectedReward);
            }
            const expectedTokenReward =
                (BigInt(origBalance) * tokenRewardedAmount * BigInt(timePercentage)) / (totalAmount * BigInt(1000));
            consoleLogger.info(
                `staker:${i}, ExpTokenReward:${expectedTokenReward}, ActTokenReward:${stakersAfterReward[i].rewardTokenBalance - origRwdTokenBal}`
            );

            if (origRwdTokenBal + expectedTokenReward !== stakersAfterReward[i].rewardTokenBalance) {
                consoleLogger.warn(
                    `staker:${i} expected: ${origRwdTokenBal + expectedTokenReward} reward but got: ${stakersAfterReward[i].rewardTokenBalance}`
                );
                expect(stakersAfterReward[i].rewardTokenBalance).toBe(origRwdTokenBal + expectedTokenReward);
            }

            partialStakeAmount += origBalance;

            algoRewardsAvail -= expectedReward;
            tokenRewardsAvail -= expectedTokenReward;
        }
    }
    const newPoolTotalStake = totalAmount - partialStakeAmount;

    // now go through again and only worry about full 100% time-in-epoch stakers
    for (let i = 0; i < stakersPriorToReward.length; i += 1) {
        if (encodeAddress(stakersPriorToReward[i].staker.publicKey) === ALGORAND_ZERO_ADDRESS_STRING) {
            continue;
        }
        const stakerEntryTime = new Date(Number(stakersPriorToReward[i].entryTime) * 1000);
        if (stakerEntryTime.getTime() >= payoutTimeToUse.getTime()) {
            consoleLogger.info(
                `staker:${i}, ${encodeAddress(stakersPriorToReward[i].staker.publicKey)} SKIPPED because entry is newer at:${stakerEntryTime.toString()}`
            );
        } else {
            const origBalance = stakersPriorToReward[i].balance;
            const origRwdTokenBal = stakersPriorToReward[i].rewardTokenBalance;
            const timeInPoolSecs: bigint =
                (BigInt(payoutTimeToUse.getTime()) - BigInt(stakerEntryTime.getTime())) / BigInt(1000);
            let timePercentage: bigint = (BigInt(timeInPoolSecs) * BigInt(1000)) / BigInt(payoutDaysInSecs); // 34.7% becomes 347
            if (timePercentage < BigInt(1000)) {
                continue;
            }
            if (timePercentage > BigInt(1000)) {
                timePercentage = BigInt(1000);
            }
            const expectedReward = (BigInt(origBalance) * algoRewardsAvail) / newPoolTotalStake;
            consoleLogger.info(
                `staker:${i}, TimePct:${timePercentage}, PctTotal:${Number((origBalance * BigInt(1000)) / newPoolTotalStake) / 10} ExpReward:${expectedReward}, ActReward:${stakersAfterReward[i].balance - origBalance} ${encodeAddress(stakersPriorToReward[i].staker.publicKey)}`
            );
            const expectedTokenReward = (BigInt(origBalance) * tokenRewardsAvail) / newPoolTotalStake;
            consoleLogger.info(
                `staker:${i}, ExpTokenReward:${expectedTokenReward}, ActTokenReward:${stakersAfterReward[i].rewardTokenBalance - origRwdTokenBal}`
            );

            if (origRwdTokenBal + expectedTokenReward !== stakersAfterReward[i].rewardTokenBalance) {
                consoleLogger.warn(
                    `staker:${i} expected: ${origRwdTokenBal + expectedTokenReward} reward but got: ${stakersAfterReward[i].rewardTokenBalance}`
                );
                expect(stakersAfterReward[i].rewardTokenBalance).toBe(origRwdTokenBal + expectedTokenReward);
            }
        }
    }
}

export async function getPoolAvailBalance(context: AlgorandTestAutomationContext, poolKey: ValidatorPoolKey) {
    const poolAcctInfo = await context.algod.accountInformation(getApplicationAddress(poolKey.poolAppId)).do();
    return BigInt(poolAcctInfo.amount - poolAcctInfo['min-balance']);
}

export async function createAsset(
    client: Algodv2,
    sender: Account,
    assetName: string,
    unitName: string,
    total?: number,
    decimals?: number
) {
    const newTotal = !total ? Math.floor(Math.random() * 100) + 20 : total;
    const newDecimals = !decimals ? 6 : decimals;

    const params = await client.getTransactionParams().do();

    const txn = makeAssetCreateTxnWithSuggestedParamsFromObject({
        from: sender.addr,
        suggestedParams: params,
        total: newTotal * 10 ** newDecimals,
        decimals: newDecimals,
        defaultFrozen: false,
        unitName,
        assetName,
        manager: sender.addr,
        reserve: sender.addr,
        freeze: sender.addr,
        clawback: sender.addr,
        assetURL: 'https://path/to/my/asset/details',
    });

    const stxn = txn.signTxn(sender.sk);

    let txid = await client.sendRawTransaction(stxn).do();
    txid = txid.txId;

    const ptx = await client.pendingTransactionInformation(txid).do();

    const assetId = ptx['asset-index'];

    return assetId;
}
