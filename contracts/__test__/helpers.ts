import {
    Account,
    Address,
    bytesToBigInt,
    decodeAddress,
    encodeAddress,
    encodeUint64,
    getApplicationAddress,
    makePaymentTxnWithSuggestedParamsFromObject,
} from 'algosdk';
import { LogicError } from '@algorandfoundation/algokit-utils/types/logic-error';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { AlgorandTestAutomationContext } from '@algorandfoundation/algokit-utils/types/testing';
import { transferAlgos } from '@algorandfoundation/algokit-utils';
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging';
import { expect } from '@jest/globals';
import { ValidatorRegistryClient } from '../contracts/clients/ValidatorRegistryClient';
import { StakingPoolClient } from '../contracts/clients/StakingPoolClient';

export const ALGORAND_ZERO_ADDRESS_STRING = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';

export class ValidatorConfig {
    ID: bigint; // ID of this validator (sequentially assigned)

    Owner: string; // Account that controls config - presumably cold-wallet

    Manager: string; // Account that triggers/pays for payouts and keyreg transactions - needs to be hotwallet as node has to sign for the transactions

    // Optional NFD AppID which the validator uses to describe their validator pool
    // NFD must be currently OWNED by address that adds the validator
    NFDForInfo: bigint;

    PayoutEveryXDays: number; // Payout frequency - ie: 7, 30, etc.

    PercentToValidator: number; // Payout percentage expressed w/ four decimals - ie: 50000 = 5% -> .0005 -

    ValidatorCommissionAddress: string; // account that receives the validation commission each epoch payout

    MinEntryStake: bigint; // minimum stake required to enter pool

    MaxAlgoPerPool: bigint; // maximum stake allowed per pool (to keep under incentive limits)

    PoolsPerNode: number; // Number of pools to allow per node (max of 4 is recommended)

    // getValidatorConfig(uint64)(uint64,address,address,uint64,uint16,uint32,address,uint64,uint64,uint8)
    // constructor to take array of values like ABI string above and set into the named instance vars
    constructor([
        ID,
        Owner,
        Manager,
        NFDForInfo,
        PayoutEveryXDays,
        PercentToValidator,
        ValidatorCommissionAddress,
        MinEntryStake,
        MaxAlgoPerPool,
        PoolsPerNode,
    ]: [bigint, string, string, bigint, number, number, string, bigint, bigint, number]) {
        this.ID = ID;
        this.Owner = Owner;
        this.Manager = Manager;
        this.NFDForInfo = NFDForInfo;
        this.PayoutEveryXDays = PayoutEveryXDays;
        this.PercentToValidator = PercentToValidator;
        this.ValidatorCommissionAddress = ValidatorCommissionAddress;
        this.MinEntryStake = MinEntryStake;
        this.MaxAlgoPerPool = MaxAlgoPerPool;
        this.PoolsPerNode = PoolsPerNode;
    }
}

const DefaultValidatorConfig: ValidatorConfig = {
    ID: BigInt(0),
    Owner: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
    Manager: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
    NFDForInfo: BigInt(0),
    PayoutEveryXDays: 1,
    PercentToValidator: 10000, // 1.0000%
    ValidatorCommissionAddress: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
    MinEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
    MaxAlgoPerPool: BigInt(AlgoAmount.Algos(200_000).microAlgos),
    PoolsPerNode: 3,
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
        configObj.PayoutEveryXDays,
        configObj.PercentToValidator,
        configObj.ValidatorCommissionAddress,
        configObj.MinEntryStake,
        configObj.MaxAlgoPerPool,
        configObj.PoolsPerNode,
    ]);
}

function validatorConfigAsArray(
    config: ValidatorConfig
): [bigint, string, string, bigint, number, number, string, bigint, bigint, number] {
    return [
        config.ID,
        config.Owner,
        config.Manager,
        config.NFDForInfo,
        config.PayoutEveryXDays,
        config.PercentToValidator,
        config.ValidatorCommissionAddress,
        config.MinEntryStake,
        config.MaxAlgoPerPool,
        config.PoolsPerNode,
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

export class PoolInfo {
    PoolAppID: bigint; // The App ID of this staking pool contract instance

    TotalStakers: number;

    TotalAlgoStaked: bigint;

    constructor([PoolAppID, TotalStakers, TotalAlgoStaked]: [bigint, number, bigint]) {
        this.PoolAppID = PoolAppID;
        this.TotalStakers = Number(TotalStakers);
        this.TotalAlgoStaked = TotalAlgoStaked;
    }
}

export class ValidatorPoolKey {
    ID: bigint;

    PoolID: bigint; // 0 means INVALID ! - so 1 is index, technically of [0]

    PoolAppID: bigint;

    constructor([ID, PoolID, PoolAppID]: [bigint, bigint, bigint]) {
        this.ID = ID;
        this.PoolID = PoolID;
        this.PoolAppID = PoolAppID;
    }

    encode(): [bigint, bigint, bigint] {
        return [this.ID, this.PoolID, this.PoolAppID];
    }
}

// StakedInfo is the testing-friendly version of what's stored as a static array in each staking pool
export class StakedInfo {
    Staker: Address;

    Balance: bigint;

    TotalRewarded: bigint;

    RewardTokenBalance: bigint;

    EntryTime: bigint;

    constructor(data: Uint8Array) {
        this.Staker = decodeAddress(encodeAddress(data.slice(0, 32)));
        this.Balance = bytesToBigInt(data.slice(32, 40));
        this.TotalRewarded = bytesToBigInt(data.slice(40, 48));
        this.RewardTokenBalance = bytesToBigInt(data.slice(48, 56));
        this.EntryTime = bytesToBigInt(data.slice(56, 64));
    }

    public static fromValues([Staker, Balance, TotalRewarded, RewardTokenBalance, EntryTime]: [
        string,
        bigint,
        bigint,
        bigint,
        bigint,
    ]): StakedInfo {
        return { Staker: decodeAddress(Staker), Balance, TotalRewarded, RewardTokenBalance, EntryTime };
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

export function getValidatorListBoxName(validatorID: number) {
    const prefix = new TextEncoder().encode('v');
    return concatUint8Arrays(prefix, encodeUint64(validatorID));
}

function getStakerPoolSetBoxName(stakerAccount: Account) {
    const prefix = new TextEncoder().encode('sps');
    return concatUint8Arrays(prefix, decodeAddress(stakerAccount.addr).publicKey);
}

function getStakersBoxName() {
    return new TextEncoder().encode('stakers');
}

export async function getMbrAmountsFromValidatorClient(validatorClient: ValidatorRegistryClient) {
    return (await validatorClient.compose().getMbrAmounts({}, {}).simulate()).returns![0];
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

export async function addStakingPool(
    context: AlgorandTestAutomationContext,
    validatorClient: ValidatorRegistryClient,
    validatorID: number,
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

    let addPoolResults: any;
    // Before validator can add pools it needs to be funded
    try {
        // Now add a staking pool
        addPoolResults = await validatorClient
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
    } catch (exception) {
        console.log((exception as LogicError).message);
        throw exception;
    }
    const poolKey = new ValidatorPoolKey(addPoolResults.returns![0]);

    // Pay the mbr to the newly created staking pool contract to cover its upcoming box mbr storage req
    await transferAlgos(
        {
            from: context.testAccount,
            to: getApplicationAddress(poolKey.PoolAppID),
            amount: AlgoAmount.MicroAlgos(Number(poolInitMbr)),
        },
        context.algod
    );

    // now tell it to initialize its storage
    const newPoolClient = new StakingPoolClient(
        { sender: vldtrAcct, resolveBy: 'id', id: poolKey.PoolAppID },
        context.algod
    );
    await newPoolClient.initStorage({}, { sendParams: { populateAppCallResources: true } });

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

        const dummy = (
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

        const poolKey = new ValidatorPoolKey(dummy[0]);
        const willBeNewStaker = dummy[1];
        const poolAppId = poolKey.PoolAppID;

        consoleLogger.info(
            `addStake findPool will add to:${poolKey.ID}, pool:${poolKey.PoolID} and willBeNew:${willBeNewStaker}`
        );

        // Pay the stake to the validator contract
        const stakeTransfer = makePaymentTxnWithSuggestedParamsFromObject({
            from: staker.addr,
            to: validatorsAppRef.appAddress,
            amount: algoAmount.microAlgos,
            suggestedParams,
        });

        // // for debugging purposes - lets simulate first so we can get logs
        // //
        // const simulateResults = await validatorClient
        //     .compose()
        //     .gas(
        //         {},
        //         {
        //             apps: [Number(poolAppId)],
        //             boxes: [
        //                 { appId: Number(poolAppId), name: new TextEncoder().encode('stakers') },
        //                 { appId: Number(poolAppId), name: '' },
        //                 { appId: Number(poolAppId), name: '' },
        //                 { appId: Number(poolAppId), name: '' },
        //                 { appId: Number(poolAppId), name: '' },
        //                 { appId: Number(poolAppId), name: '' },
        //             ],
        //         }
        //     )
        //     .addStake(
        //         // This the actual send of stake to the ac
        //         {
        //             stakedAmountPayment: { transaction: stakeTransfer, signer: staker },
        //             validatorID: vldtrId,
        //         },
        //         {
        //             sendParams: {
        //                 fee: AlgoAmount.MicroAlgos(5000),
        //             },
        //             sender: staker,
        //             // apps: [tmplPoolAppID],
        //             // boxes: [
        //             //     { appId: 0, name: getValidatorListBoxName(vldtrId) },
        //             //     { appId: 0, name: '' }, // buy more i/o
        //             //     { appId: 0, name: getStakerPoolSetName(staker) },
        //             // ],
        //         }
        //     )
        //     .simulate({ allowUnnamedResources: true, allowMoreLogging: true });
        //
        // const { logs } = simulateResults.simulateResponse.txnGroups[0].txnResults[2].txnResult;
        // // verify logs isn't undefined
        // if (logs !== undefined) {
        //     logs.forEach((uint8array) => {
        //         consoleLogger.info(new TextDecoder().decode(uint8array));
        //     });
        // }
        // stakeTransfer.group = undefined;

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

        return new ValidatorPoolKey(results.returns[1]);
    } catch (exception) {
        consoleLogger.warn((exception as LogicError).message);
        // throw validatorClient.appClient.exposeLogicError(exception as Error);
        throw exception;
    }
}

export async function removeStake(stakeClient: StakingPoolClient, staker: Account, unstakeAmount: AlgoAmount) {
    try {
        return (
            await stakeClient
                .compose()
                .gas({})
                .removeStake(
                    { amountToUnstake: unstakeAmount.microAlgos },
                    {
                        sendParams: {
                            // pays us back and tells validator about balance changed
                            fee: AlgoAmount.MicroAlgos(4000),
                        },
                        sender: staker,
                        // apps: [Number(validatorAppID)],
                        // boxes: [
                        //     { appId: 0, name: getStakersBoxName() },
                        //     { appId: 0, name: '' }, // buy more i/o
                        //     { appId: 0, name: '' }, // buy more i/o
                        //     { appId: 0, name: '' }, // buy more i/o
                        // ],
                    }
                )
                .execute({ populateAppCallResources: true })
        ).returns![1]!;
    } catch (exception) {
        consoleLogger.warn((exception as LogicError).message);
        // throw stakeClient.appClient.exposeLogicError(exception as Error);
        throw exception;
    }
}

export async function epochBalanceUpdate(stakeClient: StakingPoolClient) {
    const fees = AlgoAmount.MicroAlgos(15_000);
    const simulateResults = await stakeClient
        .compose()
        .epochBalanceUpdate({}, { sendParams: { fee: fees } })
        .simulate({ allowUnnamedResources: true, allowMoreLogging: true });

    const { logs } = simulateResults.simulateResponse.txnGroups[0].txnResults[0].txnResult;
    // verify logs isn't undefined
    if (logs !== undefined) {
        logs.forEach((uint8array) => {
            consoleLogger.info(new TextDecoder().decode(uint8array));
        });
    }
    await stakeClient.epochBalanceUpdate({}, { sendParams: { fee: fees, populateAppCallResources: true } });
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
    let i = 0;
    consoleLogger.info(`${msgToDisplay}, last Payout: ${lastPayoutTime.toUTCString()}`);
    stakers.forEach((staker) => {
        if (encodeAddress(staker.Staker.publicKey) !== ALGORAND_ZERO_ADDRESS_STRING) {
            const entryTime = new Date(Number(staker.EntryTime) * 1000);
            consoleLogger.info(
                `${i}: Staker:${encodeAddress(staker.Staker.publicKey)}, Balance:${staker.Balance}, Entry:${entryTime.toUTCString()}`
            );
        }
        i += 1;
    });
}

export function verifyRewardAmounts(
    rewardedAmount: bigint,
    stakersPriorToReward: StakedInfo[],
    stakersAfterReward: StakedInfo[]
) {
    // iterate stakersPriorToReward and total the 'Balance' value to get a 'total amount'
    // then determine if the stakersAfterReward version's balance incremented in accordance w/ their percentage of
    // the 'total' - where they get that percentage of the rewardedAmount.
    const totalAmount = stakersPriorToReward.reduce((total, staker) => BigInt(total) + staker.Balance, BigInt(0));
    for (let i = 0; i < stakersPriorToReward.length; i++) {
        if (encodeAddress(stakersPriorToReward[i].Staker.publicKey) === ALGORAND_ZERO_ADDRESS_STRING) {
            continue;
        }
        const origBalance = stakersPriorToReward[i].Balance;
        const timePercentage = BigInt(1000); // assume 100% in epoch for now
        const expectedReward = (BigInt(origBalance) * rewardedAmount * timePercentage) / (totalAmount * BigInt(1000));
        consoleLogger.info(`staker:${i}, ${encodeAddress(stakersPriorToReward[i].Staker.publicKey)}`);
        expect(stakersAfterReward[i].Balance).toBe(origBalance + expectedReward);
    }
}

export async function getPoolAvailBalance(context: AlgorandTestAutomationContext, poolKey: ValidatorPoolKey) {
    const poolAcctInfo = await context.algod.accountInformation(getApplicationAddress(poolKey.PoolAppID)).do();
    return BigInt(poolAcctInfo.amount - poolAcctInfo['min-balance']);
}
