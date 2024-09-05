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
} from 'algosdk'
import { LogicError } from '@algorandfoundation/algokit-utils/types/logic-error'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { AlgorandTestAutomationContext } from '@algorandfoundation/algokit-utils/types/testing'
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging'
import { signTransaction, waitForConfirmation } from '@algorandfoundation/algokit-utils'
import { ValidatorRegistryClient } from '../contracts/clients/ValidatorRegistryClient'
import { StakingPoolClient } from '../contracts/clients/StakingPoolClient'

export const ALGORAND_ZERO_ADDRESS_STRING = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ'

export const GATING_TYPE_NONE = 0
export const GATING_TYPE_ASSETS_CREATED_BY = 1
export const GATING_TYPE_ASSET_ID = 2
export const GATING_TYPE_CREATED_BY_NFD_ADDRESSES = 3
export const GATING_TYPE_SEGMENT_OF_NFD = 4

export class ValidatorConfig {
    id: bigint // id of this validator (sequentially assigned)

    owner: string // account that controls config - presumably cold-wallet

    manager: string // account that triggers/pays for payouts and keyreg transactions - needs to be hotwallet as node has to sign for the transactions

    // Optional NFD AppID which the validator uses to describe their validator pool
    // NFD must be currently OWNED by address that adds the validator
    nfdForInfo: bigint

    entryGatingType: number

    entryGatingAddress: string

    entryGatingAssets: [bigint, bigint, bigint, bigint]

    gatingAssetMinBalance: bigint

    rewardTokenID: bigint

    rewardPerPayout: bigint

    epochRoundLength: number // Payout frequency in minutes (can be no shorter than this)

    percentToValidator: number // Payout percentage expressed w/ four decimals - ie: 50000 = 5% -> .0005 -

    validatorCommissionAddress: string // account that receives the validation commission each epoch payout

    minEntryStake: bigint // minimum stake required to enter pool

    maxAlgoPerPool: bigint // maximum stake allowed per pool (to keep under incentive limits)

    poolsPerNode: number // Number of pools to allow per node (max of 3 is recommended)

    sunsettingOn: bigint // timestamp when validator will sunset (if != 0)

    sunsettingTo: bigint // validator id that validator is 'moving' to (if known)

    // getValidatorConfig(uint64)(uint64,address,address,uint64,uint16,uint32,address,uint64,uint64,uint8)
    // constructor to take array of values like ABI string above and set into the named instance vars
    constructor([
        id,
        owner,
        manager,
        nfdForInfo,
        entryGatingType,
        entryGatingAddress,
        entryGatingAssets,
        gatingAssetMinBalance,
        rewardTokenID,
        rewardPerPayout,
        epochRoundLength,
        percentToValidator,
        validatorCommissionAddress,
        minEntryStake,
        maxAlgoPerPool,
        poolsPerNode,
        sunsettingOn,
        sunsettingTo,
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
        this.id = id
        this.owner = owner
        this.manager = manager
        this.nfdForInfo = nfdForInfo
        this.entryGatingType = Number(entryGatingType)
        this.entryGatingAddress = entryGatingAddress
        this.entryGatingAssets = entryGatingAssets
        this.gatingAssetMinBalance = gatingAssetMinBalance
        this.rewardTokenID = rewardTokenID
        this.rewardPerPayout = rewardPerPayout
        this.epochRoundLength = Number(epochRoundLength)
        this.percentToValidator = Number(percentToValidator)
        this.validatorCommissionAddress = validatorCommissionAddress
        this.minEntryStake = minEntryStake
        this.maxAlgoPerPool = maxAlgoPerPool
        this.poolsPerNode = Number(poolsPerNode)
        this.sunsettingOn = sunsettingOn
        this.sunsettingTo = sunsettingTo
    }
}

const DefaultValidatorConfig: ValidatorConfig = {
    id: BigInt(0),
    owner: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
    manager: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
    nfdForInfo: 0n,
    entryGatingType: GATING_TYPE_NONE,
    entryGatingAddress: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
    entryGatingAssets: [0n, 0n, 0n, 0n],
    gatingAssetMinBalance: 0n,
    rewardTokenID: 0n,
    rewardPerPayout: 0n,
    epochRoundLength: 1, // minimum allowed
    percentToValidator: 10000, // 1.0000%
    validatorCommissionAddress: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
    minEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
    maxAlgoPerPool: 0n, // float w/ online caps
    poolsPerNode: 3,
    sunsettingOn: 0n,
    sunsettingTo: 0n,
}

export function createValidatorConfig(inputConfig: Partial<ValidatorConfig>): ValidatorConfig {
    const configObj = {
        ...DefaultValidatorConfig,
        ...inputConfig,
    }

    return new ValidatorConfig([
        configObj.id,
        configObj.owner,
        configObj.manager,
        configObj.nfdForInfo,
        configObj.entryGatingType,
        configObj.entryGatingAddress,
        configObj.entryGatingAssets,
        configObj.gatingAssetMinBalance,
        configObj.rewardTokenID,
        configObj.rewardPerPayout,
        configObj.epochRoundLength,
        configObj.percentToValidator,
        configObj.validatorCommissionAddress,
        configObj.minEntryStake,
        configObj.maxAlgoPerPool,
        configObj.poolsPerNode,
        configObj.sunsettingOn,
        configObj.sunsettingTo,
    ])
}

function validatorConfigAsArray(
    config: ValidatorConfig,
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
        config.id,
        config.owner,
        config.manager,
        config.nfdForInfo,
        config.entryGatingType,
        config.entryGatingAddress,
        config.entryGatingAssets,
        config.gatingAssetMinBalance,
        config.rewardTokenID,
        config.rewardPerPayout,
        config.epochRoundLength,
        config.percentToValidator,
        config.validatorCommissionAddress,
        config.minEntryStake,
        config.maxAlgoPerPool,
        config.poolsPerNode,
        config.sunsettingOn,
        config.sunsettingTo,
    ]
}

class ValidatorCurState {
    numPools: number // current number of pools this validator has - capped at MaxPools

    totalStakers: bigint // total number of stakers across all pools

    totalAlgoStaked: bigint // total amount staked to this validator across ALL of its pools

    rewardTokenHeldBack: bigint // amount of token held back for future payout to stakers

    constructor([numPools, totalStakers, totalAlgoStaked, rewardTokenHeldBack]: [number, bigint, bigint, bigint]) {
        this.numPools = Number(numPools)
        this.totalStakers = totalStakers
        this.totalAlgoStaked = totalAlgoStaked
        this.rewardTokenHeldBack = rewardTokenHeldBack
    }
}

export class PoolInfo {
    poolAppId: bigint // The App id of this staking pool contract instance

    totalStakers: number

    totalAlgoStaked: bigint

    constructor([poolAppId, totalStakers, totalAlgoStaked]: [bigint, number, bigint]) {
        this.poolAppId = poolAppId
        this.totalStakers = Number(totalStakers)
        this.totalAlgoStaked = totalAlgoStaked
    }
}

export class ValidatorPoolKey {
    id: bigint

    poolId: bigint // 0 means INVALID ! - so 1 is index, technically of [0]

    poolAppId: bigint

    constructor([id, poolId, poolAppId]: [bigint, bigint, bigint]) {
        this.id = id
        this.poolId = poolId
        this.poolAppId = poolAppId
    }

    encode(): [bigint, bigint, bigint] {
        return [this.id, this.poolId, this.poolAppId]
    }
}

// StakedInfo is the testing-friendly version of what's stored as a static array in each staking pool
export class StakedInfo {
    staker: Address

    balance: bigint

    totalRewarded: bigint

    rewardTokenBalance: bigint

    entryRound: bigint

    constructor(data: Uint8Array) {
        this.staker = decodeAddress(encodeAddress(data.slice(0, 32)))
        this.balance = bytesToBigInt(data.slice(32, 40))
        this.totalRewarded = bytesToBigInt(data.slice(40, 48))
        this.rewardTokenBalance = bytesToBigInt(data.slice(48, 56))
        this.entryRound = bytesToBigInt(data.slice(56, 64))
    }

    public static fromValues([staker, balance, totalRewarded, rewardTokenBalance, entryRound]: [
        string,
        bigint,
        bigint,
        bigint,
        bigint,
    ]): StakedInfo {
        return {
            staker: decodeAddress(staker),
            balance,
            totalRewarded,
            rewardTokenBalance,
            entryRound,
        }
    }

    public static FromBoxData(boxData: Uint8Array): StakedInfo[] {
        // take 64-byte chunks of boxData and return as an array of StakedInfo values (initialized via its constructor
        // which takes 64-byte chunks and returns an initialized StakedInfo
        const chunkSize = 64
        const stakedInfoArray: StakedInfo[] = []
        for (let i = 0; i < boxData.length; i += chunkSize) {
            const chunk = boxData.slice(i, i + chunkSize)
            stakedInfoArray.push(new StakedInfo(chunk))
        }
        return stakedInfoArray
    }
}

// ProtocolConstraints returns data from the contracts on minimums, maximums, etc.
export class ProtocolConstraints {
    epochPayoutRoundsMin: bigint

    epochPayoutRoundsMax: bigint

    MinPctToValidatorWFourDecimals: bigint

    MaxPctToValidatorWFourDecimals: bigint

    MinEntryStake: bigint // in microAlgo

    MaxAlgoPerPool: bigint // in microAlgo

    MaxAlgoPerValidator: bigint // in microAlgo

    AmtConsideredSaturated: bigint

    MaxNodes: bigint

    MaxPoolsPerNode: bigint

    MaxStakersPerPool: bigint

    constructor([
        epochPayoutRoundsMin,
        epochPayoutRoundsMax,
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
        this.epochPayoutRoundsMin = epochPayoutRoundsMin
        this.epochPayoutRoundsMax = epochPayoutRoundsMax
        this.MinPctToValidatorWFourDecimals = MinPctToValidatorWFourDecimals
        this.MaxPctToValidatorWFourDecimals = MaxPctToValidatorWFourDecimals
        this.MinEntryStake = MinEntryStake
        this.MaxAlgoPerPool = MaxAlgoPerPool
        this.MaxAlgoPerValidator = MaxAlgoPerValidator
        this.AmtConsideredSaturated = AmtConsideredSaturated
        this.MaxNodes = MaxNodes
        this.MaxPoolsPerNode = MaxPoolsPerNode
        this.MaxStakersPerPool = MaxStakersPerPool
    }

    public static fromValues([
        epochPayoutRoundsMin,
        epochPayoutRoundsMax,
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
            epochPayoutRoundsMin,
            epochPayoutRoundsMax,
            MinPctToValidatorWFourDecimals,
            MaxPctToValidatorWFourDecimals,
            MinEntryStake,
            MaxAlgoPerPool,
            MaxAlgoPerValidator,
            AmtConsideredSaturated,
            MaxNodes,
            MaxPoolsPerNode,
            MaxStakersPerPool,
        }
    }
}

class PoolTokenPayoutRatio {
    PoolPctOfWhole: bigint[]

    UpdatedForPayout: bigint

    constructor([PoolPctOfWhole, UpdatedForPayout]: [bigint[], bigint]) {
        this.PoolPctOfWhole = PoolPctOfWhole
        this.UpdatedForPayout = UpdatedForPayout
    }
}

function concatUint8Arrays(a: Uint8Array, b: Uint8Array): Uint8Array {
    const result = new Uint8Array(a.length + b.length)
    result.set(a)
    result.set(b, a.length)
    return result
}

export async function getStakeInfoFromBoxValue(stakeClient: StakingPoolClient) {
    const stakerData = await stakeClient.appClient.getBoxValue('stakers')
    return StakedInfo.FromBoxData(stakerData)
}

export function getValidatorListBoxName(validatorId: number) {
    const prefix = new TextEncoder().encode('v')
    return concatUint8Arrays(prefix, encodeUint64(validatorId))
}

// function getStakerPoolSetBoxName(stakerAccount: Account) {
//     const prefix = new TextEncoder().encode('sps');
//     return concatUint8Arrays(prefix, decodeAddress(stakerAccount.addr).publicKey);
// }

// function getStakersBoxName() {
//     return new TextEncoder().encode('stakers');
// }

export async function getMbrAmountsFromValidatorClient(validatorClient: ValidatorRegistryClient) {
    const result = await validatorClient.compose().getMbrAmounts({}, {}).simulate({ allowUnnamedResources: true })
    return result.returns![0]
}

export async function getProtocolConstraints(validatorClient: ValidatorRegistryClient) {
    return new ProtocolConstraints(
        (await validatorClient.compose().getProtocolConstraints({}, {}).simulate()).returns![0],
    )
}

function dumpLogs(logs: Uint8Array[]) {
    const asciiOnlyLogs = logs
        .map((uint8array) => new TextDecoder().decode(uint8array))
        .join('\n')
        .split('\n')
        .filter((line) => /^[\x00-\x7F]*$/.test(line))

    consoleLogger.info(asciiOnlyLogs.join('\n'))
}

export async function addValidator(
    context: AlgorandTestAutomationContext,
    validatorClient: ValidatorRegistryClient,
    owner: Account,
    config: ValidatorConfig,
    validatorMbr: bigint,
) {
    const suggestedParams = await context.algod.getTransactionParams().do()
    const validatorsAppRef = await validatorClient.appClient.getAppReference()

    suggestedParams.flatFee = true
    suggestedParams.fee = AlgoAmount.Algos(10.001).microAlgos

    // Pay the additional mbr to the validator contract for the new validator mbr
    const payValidatorMbr = makePaymentTxnWithSuggestedParamsFromObject({
        from: context.testAccount.addr,
        to: validatorsAppRef.appAddress,
        amount: Number(validatorMbr),
        suggestedParams,
    })

    try {
        const results = await validatorClient
            .compose()
            .addValidator(
                {
                    // the required MBR payment transaction..
                    mbrPayment: {
                        transaction: payValidatorMbr,
                        signer: context.testAccount,
                    },
                    // --
                    nfdName: '',
                    config: validatorConfigAsArray(config),
                },
                {
                    sender: owner,
                },
            )
            .execute({ populateAppCallResources: true, suppressLog: true })
        return Number(results.returns![0])
    } catch (e) {
        // throw validatorClient.appClient.exposeLogicError(e as Error)
        consoleLogger.warn((e as LogicError).message)
        throw e
    }
}

export async function getValidatorState(validatorClient: ValidatorRegistryClient, validatorId: number) {
    return new ValidatorCurState(
        (
            await validatorClient
                .compose()
                .getValidatorState({ validatorId }, {})
                .simulate({ allowUnnamedResources: true })
        ).returns![0],
    )
}

export async function addStakingPool(
    context: AlgorandTestAutomationContext,
    validatorClient: ValidatorRegistryClient,
    validatorId: number,
    nodeNum: number,
    vldtrAcct: Account,
    poolMbr: bigint,
    poolInitMbr: bigint,
) {
    const suggestedParams = await context.algod.getTransactionParams().do()
    const validatorsAppRef = await validatorClient.appClient.getAppReference()

    // suggestedParams.firstRound -= 15
    // suggestedParams.lastRound -= 15
    consoleLogger.info(`addStakingPool: firstRound:${suggestedParams.firstRound}`)
    // Pay the additional mbr to the validator contract for the new pool mbr
    const payPoolMbr = makePaymentTxnWithSuggestedParamsFromObject({
        from: context.testAccount.addr,
        to: validatorsAppRef.appAddress,
        amount: Number(poolMbr),
        suggestedParams,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let addPoolResults: any
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
                },
            )
            .execute({ populateAppCallResources: true, suppressLog: true })
    } catch (exception) {
        console.log((exception as LogicError).message)
        throw exception
    }
    const poolKey = new ValidatorPoolKey(addPoolResults.returns![2])

    // Pay the mbr to the newly created staking pool contract to cover its upcoming box mbr storage req
    const payStakingPoolMbr = makePaymentTxnWithSuggestedParamsFromObject({
        from: context.testAccount.addr,
        to: getApplicationAddress(poolKey.poolAppId),
        amount: Number(poolInitMbr),
        suggestedParams,
    })

    // now tell it to initialize its storage (w/ our mbr payment)
    const newPoolClient = new StakingPoolClient(
        { sender: vldtrAcct, resolveBy: 'id', id: poolKey.poolAppId },
        context.algod,
    )

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
            },
        )
        .execute({ populateAppCallResources: true, suppressLog: true })

    return poolKey
}

export async function getPoolInfo(validatorClient: ValidatorRegistryClient, poolKey: ValidatorPoolKey) {
    try {
        const PoolRet = await validatorClient
            .compose()
            .getPoolInfo({ poolKey: poolKey.encode() }, {})
            .simulate({ allowUnnamedResources: true })
        return new PoolInfo(PoolRet.returns![0])
    } catch (exception) {
        console.log((exception as LogicError).message)
        throw validatorClient.appClient.exposeLogicError(exception as Error)
        // throw exception;
    }
}

export async function getPools(validatorClient: ValidatorRegistryClient, validatorId: number): Promise<PoolInfo[]> {
    const pools = await validatorClient.getPools({ validatorId }, { sendParams: { populateAppCallResources: true } })
    const retPoolInfo: PoolInfo[] = []
    pools.return!.forEach((poolInfo) => {
        retPoolInfo.push(new PoolInfo(poolInfo))
    })
    return retPoolInfo
}

export async function getCurMaxStakePerPool(validatorClient: ValidatorRegistryClient, validatorId: number) {
    try {
        return (
            await validatorClient
                .compose()
                .getCurMaxStakePerPool({ validatorId })
                .simulate({ allowUnnamedResources: true })
        ).returns![0]
    } catch (exception) {
        console.log((exception as LogicError).message)
        throw validatorClient.appClient.exposeLogicError(exception as Error)
    }
}

export async function getStakedPoolsForAccount(
    validatorClient: ValidatorRegistryClient,
    stakerAccount: Account,
): Promise<ValidatorPoolKey[]> {
    const results = await validatorClient.getStakedPoolsForAccount(
        { staker: stakerAccount.addr },
        { sendParams: { populateAppCallResources: true } },
    )
    const retPoolKeys: ValidatorPoolKey[] = []
    results.return!.forEach((poolKey) => {
        retPoolKeys.push(new ValidatorPoolKey(poolKey))
    })
    return retPoolKeys
}

export async function getStakerInfo(stakeClient: StakingPoolClient, staker: Account) {
    try {
        return StakedInfo.fromValues(
            (
                await stakeClient
                    .compose()
                    .getStakerInfo({ staker: staker.addr }, {})
                    .simulate({ allowUnnamedResources: true })
            ).returns![0],
        )
    } catch (exception) {
        console.log((exception as LogicError).message)
        throw stakeClient.appClient.exposeLogicError(exception as Error)
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
        ).returns![0],
    )
}

export async function addStake(
    context: AlgorandTestAutomationContext,
    validatorClient: ValidatorRegistryClient,
    vldtrId: number,
    staker: Account,
    algoAmount: AlgoAmount,
    valueToVerify: bigint, // depends on gating but could be nfd id, or asset id
): Promise<[ValidatorPoolKey, AlgoAmount]> {
    try {
        const suggestedParams = await context.algod.getTransactionParams().do()
        const validatorsAppRef = await validatorClient.appClient.getAppReference()

        suggestedParams.flatFee = true
        suggestedParams.fee = 0

        const findPoolSim = await validatorClient
            .compose()
            .gas({})
            .findPoolForStaker(
                { validatorId: vldtrId, staker: staker.addr, amountToStake: algoAmount.microAlgos },
                {
                    sendParams: {
                        fee: AlgoAmount.MicroAlgos(2000),
                    },
                },
            )
            .simulate({ allowUnnamedResources: true })
        if (findPoolSim.simulateResponse.txnGroups[0].failureMessage !== undefined) {
            consoleLogger.error(
                `simulate failed in findPoolForStaker: ${findPoolSim.simulateResponse.txnGroups[0].failureMessage}`,
            )
        }
        const expectedPool = findPoolSim.returns![1]

        const poolKey = new ValidatorPoolKey(expectedPool[0])
        const willBeNewStaker = expectedPool[1]

        consoleLogger.info(
            `addStake findPool for stake:${algoAmount.toString()} will add to validator:${poolKey.id}, pool:${poolKey.poolId} and willBeNew:${willBeNewStaker}`,
        )

        // Pay the stake to the validator contract
        const stakeTransfer = makePaymentTxnWithSuggestedParamsFromObject({
            from: staker.addr,
            to: validatorsAppRef.appAddress,
            amount: algoAmount.microAlgos,
            suggestedParams,
        })

        // simulate to get fees
        let fees = AlgoAmount.MicroAlgos(240_000)
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
                { sendParams: { fee: fees }, sender: staker },
            )
            .simulate({ allowUnnamedResources: true, allowMoreLogging: true })

        const { logs } = simulateResults.simulateResponse.txnGroups[0].txnResults[2].txnResult
        if (logs !== undefined) {
            dumpLogs(logs)
        }
        stakeTransfer.group = undefined
        fees = AlgoAmount.MicroAlgos(
            2000 +
                1000 *
                    Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700),
        )
        consoleLogger.info(`addStake fees:${fees.toString()}`)

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
                { sendParams: { fee: fees }, sender: staker },
            )
            .execute({ populateAppCallResources: true, suppressLog: true })

        return [new ValidatorPoolKey(results.returns[1]), fees]
    } catch (exception) {
        consoleLogger.warn((exception as LogicError).message)
        // throw validatorClient.appClient.exposeLogicError(exception as Error);
        throw exception
    }
}

export async function removeStake(
    stakeClient: StakingPoolClient,
    staker: Account,
    unstakeAmount: AlgoAmount,
    altSender?: Account,
) {
    const simulateResults = await stakeClient
        .compose()
        .gas({}, { note: '1', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
        .gas({}, { note: '2', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
        .removeStake(
            { staker: staker.addr, amountToUnstake: unstakeAmount.microAlgos },
            {
                sendParams: {
                    fee: AlgoAmount.MicroAlgos(240000),
                },
                sender: altSender || staker,
            },
        )
        .simulate({ allowUnnamedResources: true })

    const itxnfees = AlgoAmount.MicroAlgos(
        1000 * Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700),
    )
    consoleLogger.info(`removeStake fees:${itxnfees.toString()}`)

    try {
        await stakeClient
            .compose()
            .gas({}, { note: '1', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
            .gas({}, { note: '2', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
            .removeStake(
                { staker: staker.addr, amountToUnstake: unstakeAmount.microAlgos },
                {
                    sendParams: {
                        // pays us back and tells validator about balance changed
                        fee: AlgoAmount.MicroAlgos(itxnfees.microAlgos),
                    },
                    sender: altSender || staker,
                },
            )
            .execute({ populateAppCallResources: true, suppressLog: true })
    } catch (exception) {
        consoleLogger.warn((exception as LogicError).message)
        // throw stakeClient.appClient.exposeLogicError(exception as Error);
        throw exception
    }
    return itxnfees.microAlgos
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
            },
        )
        .simulate({ allowUnnamedResources: true })

    const itxnfees = AlgoAmount.MicroAlgos(
        1000 * Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700),
    )
    consoleLogger.info(`removeStake fees:${itxnfees.toString()}`)

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
                },
            )
            .execute({ populateAppCallResources: true, suppressLog: true })
    } catch (exception) {
        consoleLogger.warn((exception as LogicError).message)
        // throw stakeClient.appClient.exposeLogicError(exception as Error);
        throw exception
    }
    return itxnfees.microAlgos
}

export async function epochBalanceUpdate(stakeClient: StakingPoolClient) {
    let fees = AlgoAmount.MicroAlgos(240_000)
    const simulateResults = await stakeClient
        .compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .epochBalanceUpdate({}, { sendParams: { fee: fees } })
        .simulate({ allowUnnamedResources: true, allowMoreLogging: true })

    const { logs } = await simulateResults.simulateResponse.txnGroups[0].txnResults[2].txnResult
    if (logs !== undefined) {
        dumpLogs(logs)
    }
    fees = AlgoAmount.MicroAlgos(
        1000 * Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700),
    )
    consoleLogger.info(`epoch update fees of:${fees.toString()}`)

    await stakeClient
        .compose()
        .gas({}, { note: '1', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
        .gas({}, { note: '2', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
        .epochBalanceUpdate({}, { sendParams: { fee: fees } })
        .execute({ populateAppCallResources: true, suppressLog: true })
    return fees
}

export async function logStakingPoolInfo(
    context: AlgorandTestAutomationContext,
    PoolAppID: bigint,
    msgToDisplay: string,
) {
    const firstPoolClient = new StakingPoolClient(
        { sender: context.testAccount, resolveBy: 'id', id: PoolAppID },
        context.algod,
    )
    const stakingPoolGS = await firstPoolClient.appClient.getGlobalState()
    const stakers = await getStakeInfoFromBoxValue(firstPoolClient)
    // iterate stakers displaying the info
    const lastPayout = stakingPoolGS.lastPayout ? stakingPoolGS.lastPayout.value : 0
    consoleLogger.info(`${msgToDisplay}, last Payout: ${lastPayout}`)
    for (let i = 0; i < stakers.length; i += 1) {
        if (encodeAddress(stakers[i].staker.publicKey) !== ALGORAND_ZERO_ADDRESS_STRING) {
            consoleLogger.info(
                `${i}: Staker:${encodeAddress(stakers[i].staker.publicKey)}, Balance:${stakers[i].balance}, ` +
                    `Rwd Tokens:${stakers[i].rewardTokenBalance} Entry:${stakers[i].entryRound}`,
            )
        }
    }
}

export async function getPoolAvailBalance(context: AlgorandTestAutomationContext, poolKey: ValidatorPoolKey) {
    const poolAcctInfo = await context.algod.accountInformation(getApplicationAddress(poolKey.poolAppId)).do()
    return BigInt(poolAcctInfo.amount - poolAcctInfo['min-balance'])
}

export async function createAsset(
    client: Algodv2,
    sender: Account,
    assetName: string,
    unitName: string,
    total?: number,
    decimals?: number,
) {
    const newTotal = !total ? Math.floor(Math.random() * 100) + 20 : total
    const newDecimals = !decimals ? 6 : decimals

    const params = await client.getTransactionParams().do()

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
    })

    const stxn = txn.signTxn(sender.sk)

    let txid = await client.sendRawTransaction(stxn).do()
    txid = txid.txId

    const ptx = await client.pendingTransactionInformation(txid).do()

    const assetId = ptx['asset-index']

    return assetId
}

export async function incrementRoundNumberBy(context: AlgorandTestAutomationContext, rounds: number) {
    if (rounds === 0) {
        return
    }
    // send rounds number of 'dummy' pay self 0 transactions
    let params = await context.algod.getTransactionParams().do()
    console.log('block before incrementRoundNumberBy:', params.firstRound)
    let txnid = ''
    for (let i = 0; i < rounds; i += 1) {
        // we definitely want the await here - we want to ensure these are a block per transaction (in dev mode)
        const txn = makePaymentTxnWithSuggestedParamsFromObject({
            from: context.testAccount.addr,
            to: context.testAccount.addr,
            amount: 0,
            note: new TextEncoder().encode(`${i}`),
            suggestedParams: params,
        })
        txnid = txn.txID()
        const signedTransaction = await signTransaction(txn, context.testAccount)
        await context.algod.sendRawTransaction(signedTransaction).do()
    }
    // wait for the final transaction to show up...
    await waitForConfirmation(txnid, rounds + 1, context.algod)

    params = await context.algod.getTransactionParams().do()
    console.log('block AFTER incrementRoundNumberBy:', params.firstRound)
}

export function bigIntFromBytes(bytes: Uint8Array): bigint {
    let result = BigInt(0)
    bytes.forEach((byte) => {
        // eslint-disable-next-line no-bitwise
        result = (result << BigInt(8)) | BigInt(byte)
    })
    return result
}
