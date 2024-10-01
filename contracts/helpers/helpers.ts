import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { PaymentParams } from '@algorandfoundation/algokit-utils/types/composer'
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging'
import { LogicError } from '@algorandfoundation/algokit-utils/types/logic-error'
import { AlgorandTestAutomationContext } from '@algorandfoundation/algokit-utils/types/testing'
import { Account, getApplicationAddress } from 'algosdk'
import { randomUUID } from 'crypto'
import { StakedInfo, StakingPoolClient, ValidatorPoolKey } from '../contracts/clients_new/StakingPoolClient'
import { PoolInfo, ValidatorConfig, ValidatorRegistryClient } from '../contracts/clients_new/ValidatorRegistryClient'

export const ALGORAND_ZERO_ADDRESS_STRING = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ'

export const GATING_TYPE_NONE = 0
export const GATING_TYPE_ASSETS_CREATED_BY = 1
export const GATING_TYPE_ASSET_ID = 2
export const GATING_TYPE_CREATED_BY_NFD_ADDRESSES = 3
export const GATING_TYPE_SEGMENT_OF_NFD = 4

const DefaultValidatorConfig: ValidatorConfig = {
    id: BigInt(0),
    owner: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
    manager: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
    nfdForInfo: 0n,
    entryGatingType: BigInt(GATING_TYPE_NONE),
    entryGatingAddress: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
    entryGatingAssets: [0n, 0n, 0n, 0n],
    gatingAssetMinBalance: 0n,
    rewardTokenId: 0n,
    rewardPerPayout: 0n,
    epochRoundLength: BigInt(1), // minimum allowed
    percentToValidator: BigInt(10000), // 1.0000%
    validatorCommissionAddress: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
    minEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
    maxAlgoPerPool: 0n, // float w/ online caps
    poolsPerNode: 3n,
    sunsettingOn: 0n,
    sunsettingTo: 0n,
}

export function createValidatorConfig(inputConfig: Partial<ValidatorConfig>): ValidatorConfig {
    return {
        ...DefaultValidatorConfig,
        ...inputConfig,
    }
}

export async function getStakeInfoFromBoxValue(stakeClient: StakingPoolClient) {
    const data = await stakeClient.state.box.stakers()
    return data!.map(
        (s) =>
            ({
                account: s[0],
                balance: s[1],
                totalRewarded: s[2],
                rewardTokenBalance: s[3],
                entryRound: s[4],
            }) satisfies StakedInfo,
    )
}

export async function getProtocolConstraints(validatorClient: ValidatorRegistryClient) {
    return (await validatorClient.newGroup().getProtocolConstraints().simulate()).returns[0]!
}

export async function addValidator(
    context: AlgorandTestAutomationContext,
    validatorClient: ValidatorRegistryClient,
    owner: Account,
    config: ValidatorConfig,
    validatorMbr: bigint,
) {
    try {
        const results = await validatorClient
            .newGroup()
            .addValidator({
                args: {
                    // the required MBR payment transaction..
                    mbrPayment: context.algorand.createTransaction.payment({
                        sender: context.testAccount.addr,
                        receiver: validatorClient.appAddress,
                        amount: AlgoAmount.MicroAlgo(validatorMbr),
                        staticFee: AlgoAmount.Algos(10.001),
                    }),
                    // --
                    nfdName: '',
                    config,
                },
                sender: owner.addr,
            })
            .send({ populateAppCallResources: true, suppressLog: true })
        return Number(results.returns![0])
    } catch (e) {
        // throw validatorClient.appClient.exposeLogicError(e as Error)
        consoleLogger.warn((e as LogicError).message)
        throw e
    }
}

export async function getValidatorState(validatorClient: ValidatorRegistryClient, validatorId: number) {
    return (await validatorClient.send.getValidatorState({ args: [validatorId], populateAppCallResources: true }))
        .return!
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
    consoleLogger.info(`addStakingPool: firstRound:${suggestedParams.firstRound}`)

    // Before validator can add pools it needs to be funded
    try {
        // Now add a staking pool
        const addPoolResults = await validatorClient
            .newGroup()
            .gas({ args: {}, note: randomUUID() })
            .gas({ args: {}, note: '2' })
            .addPool({
                args: {
                    mbrPayment: context.algorand.createTransaction.payment({
                        sender: context.testAccount.addr,
                        receiver: validatorClient.appAddress,
                        amount: AlgoAmount.MicroAlgo(poolMbr),
                    }),
                    validatorId,
                    nodeNum,
                },
                staticFee: AlgoAmount.MicroAlgos(2000),
                sender: vldtrAcct.addr,
            })
            .send({ populateAppCallResources: true, suppressLog: true })

        const poolKey = addPoolResults.returns[2]!

        // now tell it to initialize its storage (w/ our mbr payment)
        const newPoolClient = context.algorand.client.getTypedAppClientById(StakingPoolClient, {
            appId: poolKey.poolAppId,
            defaultSender: vldtrAcct.addr,
        })

        await newPoolClient
            .newGroup()
            .gas({ args: {}, note: randomUUID() })
            .gas({ args: {}, note: randomUUID() })
            .initStorage({
                args: {
                    // the required MBR payment transaction
                    mbrPayment: context.algorand.createTransaction.payment({
                        sender: context.testAccount.addr,
                        receiver: newPoolClient.appAddress,
                        amount: AlgoAmount.MicroAlgo(poolInitMbr),
                    }),
                },
                staticFee: AlgoAmount.MicroAlgos(3000),
            })
            .send({ populateAppCallResources: true, suppressLog: true })

        return poolKey
    } catch (exception) {
        console.log((exception as LogicError).message)
        throw exception
    }
}

export async function getPoolInfo(validatorClient: ValidatorRegistryClient, poolKey: ValidatorPoolKey) {
    return (await validatorClient.send.getPoolInfo({ args: [poolKey], populateAppCallResources: true })).return!
}

export async function getPools(validatorClient: ValidatorRegistryClient, validatorId: number): Promise<PoolInfo[]> {
    return (
        await validatorClient
            .newGroup()
            .getPools({ args: [validatorId] })
            .simulate({ allowUnnamedResources: true })
    ).returns[0]!.map(
        (poolInfo) =>
            ({ poolAppId: poolInfo[0], totalStakers: poolInfo[1], totalAlgoStaked: poolInfo[2] }) satisfies PoolInfo,
    )
}

export async function getCurMaxStakePerPool(validatorClient: ValidatorRegistryClient, validatorId: number) {
    return (
        await validatorClient.send.getCurMaxStakePerPool({
            args: [validatorId],
            populateAppCallResources: true,
        })
    ).return!
}

export async function getStakedPoolsForAccount(
    validatorClient: ValidatorRegistryClient,
    stakerAccount: Account,
): Promise<ValidatorPoolKey[]> {
    const results = await validatorClient.send.getStakedPoolsForAccount({
        args: { staker: stakerAccount.addr },
        populateAppCallResources: true,
    })

    const retPoolKeys: ValidatorPoolKey[] = []
    results.return!.forEach((poolKey) => {
        retPoolKeys.push({ id: poolKey[0], poolId: poolKey[1], poolAppId: poolKey[2] } satisfies ValidatorPoolKey)
    })
    return retPoolKeys
}

export async function getStakerInfo(stakeClient: StakingPoolClient, staker: Account) {
    return (
        await stakeClient.send.getStakerInfo({
            args: { staker: staker.addr },
            populateAppCallResources: true,
        })
    ).return!
}

export async function getTokenPayoutRatio(validatorClient: ValidatorRegistryClient, validatorId: number) {
    return (await validatorClient.send.getTokenPayoutRatio({ args: [validatorId], populateAppCallResources: true }))
        .return!
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
        const findPoolSim = await validatorClient
            .newGroup()
            .gas()
            .findPoolForStaker({
                args: { validatorId: vldtrId, staker: staker.addr, amountToStake: algoAmount.microAlgos },
                staticFee: AlgoAmount.MicroAlgos(2000),
            })
            .simulate({ allowUnnamedResources: true })
        if (findPoolSim.simulateResponse.txnGroups[0].failureMessage !== undefined) {
            consoleLogger.error(
                `simulate failed in findPoolForStaker: ${findPoolSim.simulateResponse.txnGroups[0].failureMessage}`,
            )
        }
        const expectedPool = findPoolSim.returns[1]!

        const poolKey = {
            id: expectedPool[0][0],
            poolId: expectedPool[0][1],
            poolAppId: expectedPool[0][2],
        } satisfies ValidatorPoolKey
        const willBeNewStaker = expectedPool[1]

        consoleLogger.info(
            `addStake findPool for stake:${algoAmount.toString()} will add to validator:${poolKey.id}, pool:${poolKey.poolId} and willBeNew:${willBeNewStaker}`,
        )

        const stakeTransfer: PaymentParams = {
            sender: staker.addr,
            receiver: validatorClient.appAddress,
            amount: algoAmount,
            staticFee: (0).algo(),
        }

        // simulate to get fees
        let fees = AlgoAmount.MicroAlgos(240_000)
        const simulateResults = await validatorClient
            .newGroup()
            .gas()
            .addStake(
                // This the actual send of stake to the ac
                {
                    args: {
                        stakedAmountPayment: context.algorand.createTransaction.payment(stakeTransfer),
                        validatorId: vldtrId,
                        valueToVerify,
                    },
                    staticFee: fees,
                    sender: staker.addr,
                },
            )
            .simulate({ allowUnnamedResources: true, allowMoreLogging: true })

        fees = AlgoAmount.MicroAlgos(
            2000 +
                1000 *
                    Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700),
        )
        consoleLogger.info(`addStake fees:${fees.toString()}`)

        const results = await validatorClient
            .newGroup()
            .gas({ args: [], staticFee: AlgoAmount.MicroAlgos(0) })
            .addStake({
                args: {
                    // --
                    // This the actual send of stake to the validator contract (which then sends to the staking pool)
                    stakedAmountPayment: context.algorand.createTransaction.payment(stakeTransfer),
                    // --
                    validatorId: vldtrId,
                    valueToVerify,
                },
                staticFee: fees,
                sender: staker.addr,
            })
            .send({ populateAppCallResources: true, suppressLog: true })

        return [results.returns[1]!, fees]
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
        .newGroup()
        .gas({ args: [], note: '1', staticFee: AlgoAmount.MicroAlgos(0) })
        .gas({ args: [], note: '2', staticFee: AlgoAmount.MicroAlgos(0) })
        .removeStake({
            args: { staker: staker.addr, amountToUnstake: unstakeAmount.microAlgos },
            staticFee: AlgoAmount.MicroAlgos(240000),
            sender: (altSender || staker).addr,
        })
        .simulate({ allowUnnamedResources: true })

    const itxnfees = AlgoAmount.MicroAlgos(
        1000 * Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700),
    )
    consoleLogger.info(`removeStake fees:${itxnfees.toString()}`)

    try {
        await stakeClient
            .newGroup()
            .gas({ args: [], note: '1', staticFee: AlgoAmount.MicroAlgos(0) })
            .gas({ args: [], note: '2', staticFee: AlgoAmount.MicroAlgos(0) })
            .removeStake({
                args: { staker: staker.addr, amountToUnstake: unstakeAmount.microAlgos },
                staticFee: AlgoAmount.MicroAlgos(itxnfees.microAlgo),
                sender: (altSender || staker).addr,
            })
            .send({ populateAppCallResources: true, suppressLog: true })
    } catch (exception) {
        consoleLogger.warn((exception as LogicError).message)
        // throw stakeClient.appClient.exposeLogicError(exception as Error);
        throw exception
    }
    return itxnfees.microAlgos
}

export async function claimTokens(stakeClient: StakingPoolClient, staker: Account) {
    const simulateResults = await stakeClient
        .newGroup()
        .gas({ args: [], note: '1', staticFee: AlgoAmount.MicroAlgos(0) })
        .gas({ args: [], note: '2', staticFee: AlgoAmount.MicroAlgos(0) })
        .claimTokens({ args: {}, staticFee: AlgoAmount.MicroAlgos(240000), sender: staker.addr })
        .simulate({ allowUnnamedResources: true })

    const itxnfees = AlgoAmount.MicroAlgos(
        1000 * Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700),
    )
    consoleLogger.info(`removeStake fees:${itxnfees.toString()}`)

    try {
        await stakeClient
            .newGroup()
            .gas({ args: [], note: '1', staticFee: AlgoAmount.MicroAlgos(0) })
            .gas({ args: [], note: '2', staticFee: AlgoAmount.MicroAlgos(0) })
            .claimTokens({ args: {}, staticFee: AlgoAmount.MicroAlgos(itxnfees.microAlgo), sender: staker.addr })
            .send({ populateAppCallResources: true, suppressLog: true })
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
        .newGroup()
        .gas({ args: [], note: '1', staticFee: AlgoAmount.MicroAlgos(0) })
        .gas({ args: [], note: '2', staticFee: AlgoAmount.MicroAlgos(0) })
        .epochBalanceUpdate({ args: {}, staticFee: fees })
        .simulate({ allowUnnamedResources: true, allowMoreLogging: true })

    fees = AlgoAmount.MicroAlgos(
        1000 * Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700),
    )
    consoleLogger.info(`epoch update fees of:${fees.toString()}`)

    await stakeClient
        .newGroup()
        .gas({ args: [], note: '1', staticFee: AlgoAmount.MicroAlgos(0) })
        .gas({ args: [], note: '2', staticFee: AlgoAmount.MicroAlgos(0) })
        .epochBalanceUpdate({ args: {}, staticFee: fees })
        .send({ populateAppCallResources: true, suppressLog: true })
    return fees
}

export async function logStakingPoolInfo(
    context: AlgorandTestAutomationContext,
    poolAppID: bigint,
    msgToDisplay: string,
) {
    const firstPoolClient = context.algorand.client.getTypedAppClientById(StakingPoolClient, {
        appId: poolAppID,
        defaultSender: context.testAccount.addr,
    })
    const stakingPoolGS = await firstPoolClient.state.global.getAll()
    const stakers = await getStakeInfoFromBoxValue(firstPoolClient)
    // iterate stakers displaying the info
    const lastPayout = stakingPoolGS.lastPayout ? stakingPoolGS.lastPayout : 0n
    consoleLogger.info(`${msgToDisplay}, last Payout: ${lastPayout}`)
    for (let i = 0; i < stakers.length; i += 1) {
        if (stakers[i].account !== ALGORAND_ZERO_ADDRESS_STRING) {
            consoleLogger.info(
                `${i}: Staker:${stakers[i].account}, Balance:${stakers[i].balance}, ` +
                    `Rwd Tokens:${stakers[i].rewardTokenBalance} Entry:${stakers[i].entryRound}`,
            )
        }
    }
}

export async function getPoolAvailBalance(context: AlgorandTestAutomationContext, poolKey: ValidatorPoolKey) {
    const poolAcctInfo = await context.algorand.account.getInformation(getApplicationAddress(poolKey.poolAppId))
    return poolAcctInfo.balance.microAlgo - poolAcctInfo.minBalance.microAlgo
}

export async function createAsset(
    context: AlgorandTestAutomationContext,
    sender: Account,
    assetName: string,
    unitName: string,
    total?: number,
    decimals?: number,
) {
    const newTotal = !total ? Math.floor(Math.random() * 100) + 20 : total
    const newDecimals = !decimals ? 6 : decimals

    const asset = await context.algorand.send.assetCreate({
        sender: sender.addr,
        total: BigInt(newTotal * 10 ** newDecimals),
        decimals: newDecimals,
        defaultFrozen: false,
        unitName,
        assetName,
        manager: sender.addr,
        reserve: sender.addr,
        freeze: sender.addr,
        clawback: sender.addr,
        url: 'https://path/to/my/asset/details',
    })

    return asset.assetId
}

export async function incrementRoundNumberBy(context: AlgorandTestAutomationContext, rounds: number) {
    if (rounds === 0) {
        return
    }
    // Send `rounds` number of 'dummy' pay self 0 transactions
    let params = await context.algod.getTransactionParams().do()
    console.log('block before incrementRoundNumberBy:', params.firstRound)
    for (let i = 0; i < rounds; i += 1) {
        await context.algorand.send.payment({
            sender: context.testAccount.addr,
            receiver: context.testAccount.addr,
            amount: AlgoAmount.MicroAlgo(0),
            note: randomUUID(),
        })
    }

    params = await context.algod.getTransactionParams().do()
    console.log('block AFTER incrementRoundNumberBy:', params.firstRound)
}
