import * as algokit from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { QueryClient } from '@tanstack/react-query'
import algosdk from 'algosdk'
import { fetchAccountBalance, fetchAsset, isOptedInToAsset } from '@/api/algod'
import {
  getSimulateStakingPoolClient,
  getSimulateValidatorClient,
  getStakingPoolClient,
  getStakingPoolFactory,
  getValidatorClient,
} from '@/api/clients'
import { fetchNfd } from '@/api/nfd'
import { ALGORAND_ZERO_ADDRESS_STRING } from '@/constants/accounts'
import { GatingType } from '@/constants/gating'
import {
  StakedInfo,
  StakedInfoFromTuple,
  StakingPoolClient,
  ValidatorPoolKey,
} from '@/contracts/StakingPoolClient'
import {
  Constraints,
  MbrAmounts,
  NodePoolAssignmentConfig,
  PoolInfo,
  ValidatorConfig,
  ValidatorRegistryClient,
} from '@/contracts/ValidatorRegistryClient'
import { Asset } from '@/interfaces/algod'
import { StakerPoolData, StakerValidatorData } from '@/interfaces/staking'
import {
  EntryGatingAssets,
  FindPoolForStakerResponse,
  LocalPoolInfo,
  PoolData,
  Validator,
  ValidatorConfigInput,
} from '@/interfaces/validator'
import { makeEmptyTransactionSigner } from '@/lib/makeEmptyTransactionSigner'
import { BalanceChecker } from '@/utils/balanceChecker'
import { calculateValidatorPoolMetrics } from '@/utils/contracts'
import { ParamsCache } from '@/utils/paramsCache'
import { encodeCallParams } from '@/utils/tests/abi'

export function callGetNumValidators(validatorClient: ValidatorRegistryClient) {
  return validatorClient.send.getNumValidators({
    args: {},
  })
}

export function callGetValidatorConfig(
  validatorId: number | bigint,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient.send.getValidatorConfig({
    args: { validatorId },
  })
}

export function callGetValidatorState(
  validatorId: number | bigint,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient.send.getValidatorState({ args: { validatorId } })
}

async function processPool(pool: LocalPoolInfo): Promise<PoolData> {
  const poolBalance = await fetchAccountBalance(algosdk.getApplicationAddress(pool.poolAppId), true)
  if (poolBalance === 0) {
    return { balance: 0n }
  }

  const stakingPoolClient = await getSimulateStakingPoolClient(pool.poolAppId)
  const stakingPoolGS = await stakingPoolClient.state.global.getAll()

  const lastPayout = stakingPoolGS.lastPayout
  const ewma = stakingPoolGS.weightedMovingAverage
  const apy = ewma ? Number(ewma) / 10000 : undefined

  return {
    balance: BigInt(poolBalance),
    lastPayout,
    apy,
  }
}

async function setValidatorPoolMetrics(validator: Validator, queryClient?: QueryClient) {
  if (validator.pools.length === 0) return

  try {
    const epochRoundLength = BigInt(validator.config.epochRoundLength)
    const params = await ParamsCache.getSuggestedParams()

    const poolDataPromises = validator.pools.map((pool) => processPool(pool))
    const poolsData = await Promise.all(poolDataPromises)

    const { rewardsBalance, roundsSinceLastPayout, apy } = calculateValidatorPoolMetrics(
      poolsData,
      validator.state.totalAlgoStaked,
      epochRoundLength,
      BigInt(params.firstRound),
    )

    validator.rewardsBalance = rewardsBalance
    validator.roundsSinceLastPayout = roundsSinceLastPayout
    validator.apy = apy

    // Seed query cache
    poolsData.forEach((data, index) => {
      if (data.apy !== undefined) {
        queryClient?.setQueryData(['pool-apy', Number(validator.pools[index].poolAppId)], data.apy)
      }
    })
    queryClient?.setQueryData(['available-rewards', validator.id], Number(rewardsBalance))
    queryClient?.setQueryData(
      ['rounds-since-last-payout', validator.id],
      Number(roundsSinceLastPayout),
    )
    queryClient?.setQueryData(['validator-apy', validator.id], apy)
  } catch (error) {
    console.error(error)
  }
}

/**
 * Fetches the validator's configuration, state, pools info, node pool assignments, reward token
 * (if one is configured), NFD for info, and pool metrics. When this is called by the
 * `fetchValidators` function, the `queryClient` parameter is passed in to seed the query cache.
 * @param {string | number} validatorId - The validator's ID.
 * @param {QueryClient} queryClient - The query client to seed the query cache.
 * @return {Promise<Validator>} The validator object.
 */
export async function fetchValidator(
  validatorId: string | number,
  queryClient?: QueryClient,
): Promise<Validator> {
  try {
    const validatorClient = await getSimulateValidatorClient()

    const [config, state, validatorPoolData, nodePoolAssignments] = await Promise.all([
      callGetValidatorConfig(Number(validatorId), validatorClient),
      callGetValidatorState(Number(validatorId), validatorClient),
      callGetPools(Number(validatorId), validatorClient),
      callGetNodePoolAssignments(Number(validatorId), validatorClient),
    ])

    const Config = config.return!
    const State = state.return!
    const PoolsInfo = validatorPoolData.return!
    const NodePoolAssignment = nodePoolAssignments.return!

    if (!Config || !State || !PoolsInfo || !NodePoolAssignment) {
      throw new ValidatorNotFoundError(`Validator with id "${Number(validatorId)}" not found!`)
    }
    const convertedPools: LocalPoolInfo[] = PoolsInfo.map(
      (poolInfo: [bigint, number, bigint], i: number) => ({
        poolId: BigInt(i + 1),
        poolAppId: poolInfo[0],
        totalStakers: poolInfo[1],
        totalAlgoStaked: poolInfo[2],
      }),
    )
    // Transform raw data to Validator object
    const validator: Validator = {
      id: Number(Config.id),
      config: Config,
      state: State,
      pools: convertedPools,
      nodePoolAssignment: NodePoolAssignment,
    }
    await setValidatorPoolMetrics(validator, queryClient)

    if (validator.config.rewardTokenId > 0) {
      const rewardToken = await fetchAsset(validator.config.rewardTokenId)
      validator.rewardToken = rewardToken
    }

    if (validator.config.entryGatingType === GatingType.AssetId) {
      const gatingAssets = await Promise.all(
        validator.config.entryGatingAssets.map(async (assetId) => {
          if (assetId > 0) {
            return fetchAsset(assetId)
          }
          return null
        }),
      )

      validator.gatingAssets = gatingAssets.filter(Boolean) as Asset[]
    }

    if (validator.config.nfdForInfo > 0) {
      const nfd = await fetchNfd(validator.config.nfdForInfo, { view: 'full' })
      validator.nfd = nfd
    }

    // Seed the query cache with the validator data
    queryClient?.setQueryData(['validator', String(validatorId)], validator)

    return validator
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function fetchValidators(queryClient: QueryClient) {
  try {
    const validatorClient = await getSimulateValidatorClient()

    // App call to fetch total number of validators
    const numValidatorsResponse = await callGetNumValidators(validatorClient)

    const numValidators = numValidatorsResponse.return!

    if (!numValidators) {
      return []
    }

    const allValidators: Array<Validator> = []
    const batchSize = 10

    for (let i = 0; i < numValidators; i += batchSize) {
      const batchPromises = Array.from(
        { length: Math.min(batchSize, Number(numValidators) - i) },
        (_, index) => {
          const validatorId = i + index + 1
          return fetchValidator(validatorId, queryClient)
        },
      )

      // Run batch calls in parallel, then filter out any undefined results
      const batchResults = (await Promise.all(batchPromises)).filter(
        (validator) => validator !== undefined,
      ) as Array<Validator>

      allValidators.push(...batchResults)
    }

    return allValidators
  } catch (error) {
    console.error(error)
    throw error
  }
}

export class ValidatorNotFoundError extends Error {}

export async function addValidator(
  values: ValidatorConfigInput,
  nfdAppId: bigint,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
  authAddr?: string,
) {
  const validatorClient = await getValidatorClient(signer, activeAddress)

  const { addValidatorMbr } = (
    await validatorClient.send.getMbrAmounts({
      args: {},
      signer: makeEmptyTransactionSigner(authAddr),
    })
  ).return!

  const payValidatorMbr = await validatorClient.appClient.createTransaction.fundAppAccount({
    sender: activeAddress,
    amount: AlgoAmount.MicroAlgo(addValidatorMbr),
    extraFee: AlgoAmount.Algos(10),
  })

  // Check balance
  const requiredBalance = Number(payValidatorMbr.amount) + payValidatorMbr.fee + 1000
  await BalanceChecker.check(activeAddress, requiredBalance, 'Add validator')

  const entryGatingType = Number(values.entryGatingType || 0)
  const entryGatingAddress = values.entryGatingAddress || ALGORAND_ZERO_ADDRESS_STRING
  const entryGatingAssets = new Array(4).fill(0n) as EntryGatingAssets

  for (let i = 0; i < values.entryGatingAssets.length && i < 4; i++) {
    entryGatingAssets[i] = BigInt(values.entryGatingAssets[i] || 0n)
  }

  const validatorConfig: ValidatorConfig = {
    id: 0n, // id not known yet
    owner: values.owner,
    manager: values.manager,
    nfdForInfo: nfdAppId,
    entryGatingType,
    entryGatingAddress,
    entryGatingAssets,
    gatingAssetMinBalance: BigInt(values.gatingAssetMinBalance || 0),
    rewardTokenId: BigInt(values.rewardTokenId) || 0n,
    rewardPerPayout: BigInt(values.rewardPerPayout) || 0n,
    epochRoundLength: Number(values.epochRoundLength),
    percentToValidator: Number(values.percentToValidator) * 10000,
    validatorCommissionAddress: values.validatorCommissionAddress,
    minEntryStake: AlgoAmount.Algos(BigInt(values.minEntryStake)).microAlgos,
    maxAlgoPerPool: 0n,
    poolsPerNode: Number(values.poolsPerNode),
    sunsettingOn: 0n,
    sunsettingTo: 0n,
  }

  const result = await validatorClient
    .newGroup()
    .addValidator({
      args: {
        mbrPayment: payValidatorMbr,
        nfdName: values.nfdForInfo || '',
        config: validatorConfig,
      },
    })
    .send({ populateAppCallResources: true })

  return Number(result.returns![0])
}

export function callGetNodePoolAssignments(
  validatorId: number | bigint,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient.send.getNodePoolAssignments({ args: { validatorId } })
}

export async function fetchNodePoolAssignments(
  validatorId: string | number | bigint,
): Promise<NodePoolAssignmentConfig> {
  try {
    const validatorClient = await getSimulateValidatorClient()

    return (await callGetNodePoolAssignments(BigInt(validatorId), validatorClient)).return!
  } catch (error) {
    console.error(error)
    throw error
  }
}

export function callGetMbrAmounts(validatorClient: ValidatorRegistryClient) {
  return validatorClient.send.getMbrAmounts({ args: {} })
}

export async function fetchMbrAmounts(client?: ValidatorRegistryClient): Promise<MbrAmounts> {
  try {
    const validatorClient = client || (await getSimulateValidatorClient())

    return (await callGetMbrAmounts(validatorClient)).return!
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function addStakingPool(
  validatorId: bigint,
  nodeNum: number,
  poolMbr: bigint,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
): Promise<ValidatorPoolKey> {
  const validatorClient = await getValidatorClient(signer, activeAddress)

  const payValidatorAddPoolMbr = await validatorClient.appClient.createTransaction.fundAppAccount({
    sender: activeAddress,
    amount: AlgoAmount.MicroAlgo(poolMbr),
  })
  // Check balance
  const requiredBalance =
    Number(payValidatorAddPoolMbr.amount) + payValidatorAddPoolMbr.fee + 1000 + 1000 + 2000
  await BalanceChecker.check(activeAddress, requiredBalance, 'Add staking pool')

  const addPoolResponse = await validatorClient
    .newGroup()
    .gas({ args: {}, note: '1' })
    .gas({ args: {}, note: '2' })
    .addPool({
      args: { mbrPayment: payValidatorAddPoolMbr, validatorId, nodeNum },
      extraFee: AlgoAmount.MicroAlgos(1000),
      sender: activeAddress,
      validityWindow: 100,
    })
    .send({ populateAppCallResources: true })

  return addPoolResponse.returns![2]!
}

export async function initStakingPoolStorage(
  poolAppId: bigint,
  poolInitMbr: bigint,
  optInRewardToken: boolean,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
): Promise<void> {
  const suggestedParams = await ParamsCache.getSuggestedParams()
  const mbrAmount = optInRewardToken ? poolInitMbr + AlgoAmount.Algos(0.1).microAlgos : poolInitMbr

  const payPoolInitStorageMbr = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: activeAddress,
    to: algosdk.getApplicationAddress(poolAppId),
    amount: mbrAmount,
    suggestedParams,
  })

  // Check balance
  const requiredBalance =
    Number(payPoolInitStorageMbr.amount) + payPoolInitStorageMbr.fee + 1000 + 1000 + 3000
  await BalanceChecker.check(activeAddress, requiredBalance, 'Pool storage requirement payment')

  const stakingPoolClient = await getStakingPoolClient(poolAppId, signer, activeAddress)

  await stakingPoolClient
    .newGroup()
    .gas({ args: {}, note: '1' })
    .gas({ args: {}, note: '2' })
    .initStorage({
      args: {
        // the required MBR payment transaction
        mbrPayment: payPoolInitStorageMbr,
      },
      extraFee: AlgoAmount.MicroAlgos(2000),
    })
    .send({ populateAppCallResources: true })
}

export async function doesStakerNeedToPayMbr(
  activeAddress: string,
  authAddr?: string,
  client?: ValidatorRegistryClient,
): Promise<boolean> {
  const validatorClient = client || (await getSimulateValidatorClient(activeAddress, authAddr))

  const result = await validatorClient.send.doesStakerNeedToPayMbr({
    args: { staker: activeAddress },
  })

  if (result.returns?.[0] === undefined) {
    throw new Error('Error checking if staker needs to pay MBR')
  }
  return result.return!
}

export async function findPoolForStaker(
  validatorId: number,
  amountToStake: bigint,
  activeAddress: string,
  authAddr?: string,
  client?: ValidatorRegistryClient,
): Promise<FindPoolForStakerResponse> {
  const validatorClient = client || (await getSimulateValidatorClient(activeAddress, authAddr))

  const result = await validatorClient
    .newGroup()
    .gas({
      args: {},
    })
    .findPoolForStaker({
      args: {
        validatorId,
        staker: activeAddress,
        amountToStake,
      },
      extraFee: AlgoAmount.MicroAlgos(1000),
    })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })

  const errorMessage = result.simulateResponse.txnGroups[0].failureMessage

  if (errorMessage || !result.returns[1]) {
    throw new Error(`Error finding pool for staker: ${errorMessage || 'No pool found'}`)
  }
  const [[valId, poolId, poolAppId], isNewStakerToValidator, isNewStakerToProtocol] =
    result.returns[1]

  const poolKey: ValidatorPoolKey = {
    id: valId,
    poolId: poolId,
    poolAppId: poolAppId,
  }

  return { poolKey, isNewStakerToValidator, isNewStakerToProtocol }
}

export async function addStake(
  validatorId: number,
  stakeAmount: bigint | number, // microalgos
  valueToVerify: bigint,
  rewardTokenId: bigint,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
  authAddr?: string,
): Promise<ValidatorPoolKey> {
  const validatorClient = await getValidatorClient(signer, activeAddress)
  const suggestedParams = await ParamsCache.getSuggestedParams()

  const stakeTransferPayment = await validatorClient.appClient.createTransaction.fundAppAccount({
    sender: activeAddress,
    amount: AlgoAmount.MicroAlgo(stakeAmount),
  })

  const needsOptInTxn = rewardTokenId > 0 && !(await isOptedInToAsset(activeAddress, rewardTokenId))

  const simulateValidatorClient = await getSimulateValidatorClient(activeAddress, authAddr)

  const simulateComposer = simulateValidatorClient
    .newGroup()
    .gas({ args: {} })
    .addStake(
      // This the actual send of stake to the ac
      {
        args: {
          stakedAmountPayment: stakeTransferPayment,
          validatorId,
          valueToVerify,
        },
        staticFee: AlgoAmount.MicroAlgos(240_000),
        validityWindow: 200,
      },
    )

  if (needsOptInTxn) {
    const rewardTokenOptInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: activeAddress,
      to: activeAddress,
      amount: 0,
      assetIndex: Number(rewardTokenId),
      suggestedParams,
    })

    simulateComposer.addTransaction(rewardTokenOptInTxn, makeEmptyTransactionSigner(authAddr))
  }

  const simulateResults = await simulateComposer.simulate({
    allowEmptySignatures: true,
    allowUnnamedResources: true,
  })

  stakeTransferPayment.group = undefined

  const feeAmount = AlgoAmount.MicroAlgos(
    1000 *
      Math.floor(
        ((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700,
      ) -
      1000, // subtract back out the opcodes added from the gas call(s) which were paid as part of their normal fees,
  )

  let requiredBalance =
    BigInt(stakeTransferPayment.amount) + BigInt(stakeTransferPayment.fee) + feeAmount.microAlgos

  const composer = validatorClient
    .newGroup()
    .gas({ args: [] })
    .addStake({
      args: {
        // --
        // This the actual send of stake to the validator contract (which then sends to the staking pool)
        stakedAmountPayment: { txn: stakeTransferPayment, signer },
        // --
        validatorId,
        valueToVerify,
      },
      extraFee: feeAmount,
    })

  if (needsOptInTxn) {
    const rewardTokenOptInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: activeAddress,
      to: activeAddress,
      amount: 0,
      assetIndex: Number(rewardTokenId),
      suggestedParams,
    })

    requiredBalance += BigInt(rewardTokenOptInTxn.fee)

    composer.addTransaction(rewardTokenOptInTxn)
  }

  // Check balance
  await BalanceChecker.check(activeAddress, Number(requiredBalance), 'Add stake')

  const result = await composer.send({ populateAppCallResources: true })

  return result.returns![1]!
}

export async function callFindPoolForStaker(
  validatorId: number | bigint,
  staker: string,
  amountToStake: number | bigint,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient.send.findPoolForStaker({ args: { validatorId, staker, amountToStake } })
}

export async function isNewStakerToValidator(
  validatorId: number | bigint,
  staker: string,
  minEntryStake: number | bigint,
) {
  const validatorClient = await getSimulateValidatorClient()
  const result = await callFindPoolForStaker(validatorId, staker, minEntryStake, validatorClient)

  const [_, isNewStaker] = result.return!

  return isNewStaker
}

export async function callGetStakedPoolsForAccount(
  staker: string,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient.send.getStakedPoolsForAccount({ args: { staker } })
}

export async function fetchStakedPoolsForAccount(staker: string): Promise<ValidatorPoolKey[]> {
  try {
    const validatorClient = await getSimulateValidatorClient()
    const result = await callGetStakedPoolsForAccount(staker, validatorClient)

    const stakedPools = result.return!

    // Filter out potential duplicates (temporary UI fix for duplicate staked pools bug)
    const uniqueStakedPools = Array.from(
      new Set(stakedPools.map((sp) => JSON.stringify(sp.map((v) => Number(v))))),
    ).map((sp) => JSON.parse(sp) as (typeof stakedPools)[0])

    // return uniqueStakedPools
    return uniqueStakedPools.map(([validatorId, poolId, poolAppId]) => ({
      id: validatorId,
      poolId: poolId,
      poolAppId: poolAppId,
    }))
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function callGetStakerInfo(staker: string, stakingPoolClient: StakingPoolClient) {
  return stakingPoolClient.send.getStakerInfo({ args: { staker } })
}

export async function fetchStakerPoolData(
  poolKey: ValidatorPoolKey,
  staker: string,
): Promise<StakerPoolData> {
  try {
    const stakingPoolClient = await getSimulateStakingPoolClient(poolKey.poolAppId)
    const stakingPoolGS = await stakingPoolClient.appClient.getGlobalState()

    let lastPayoutRound: bigint = 0n

    if (stakingPoolGS.lastPayout !== undefined) {
      lastPayoutRound = BigInt(stakingPoolGS.lastPayout.value)
    }

    const result = await callGetStakerInfo(staker, stakingPoolClient)

    const stakedInfo = result.return!

    return {
      ...stakedInfo,
      poolKey,
      lastPayout: lastPayoutRound,
    }
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function fetchStakerValidatorData(staker: string): Promise<StakerValidatorData[]> {
  try {
    const poolKeys = await fetchStakedPoolsForAccount(staker)

    const allPools: Array<StakerPoolData> = []
    const batchSize = 10

    for (let i = 0; i < poolKeys.length; i += batchSize) {
      const batchPromises = Array.from(
        { length: Math.min(batchSize, poolKeys.length - i) },
        (_, index) => {
          const poolKey = poolKeys[i + index]
          return fetchStakerPoolData(poolKey, staker)
        },
      )

      // Run batch calls in parallel
      const batchResults = await Promise.all(batchPromises)

      allPools.push(...batchResults)
    }

    // Group pool stakes by validatorId and sum up balances
    const stakerValidatorData = allPools.reduce((acc, pool) => {
      const { id: validatorId } = pool.poolKey

      // Check if we already have an entry for this validator
      const existingData = acc.find((data) => data.validatorId === validatorId)

      if (existingData) {
        // staker is in another pool for this validator, update validator totals
        existingData.balance += pool.balance
        existingData.totalRewarded += pool.totalRewarded
        existingData.rewardTokenBalance += pool.rewardTokenBalance
        existingData.entryRound =
          pool.entryRound > existingData.entryRound ? pool.entryRound : existingData.entryRound
        existingData.lastPayout =
          existingData.lastPayout > pool.lastPayout ? existingData.lastPayout : pool.lastPayout
        existingData.pools.push(pool) // add pool to existing StakerPoolData[]
      } else {
        // First pool for this validator, add new entry
        acc.push({
          validatorId,
          balance: pool.balance,
          totalRewarded: pool.totalRewarded,
          rewardTokenBalance: pool.rewardTokenBalance,
          entryRound: pool.entryRound,
          lastPayout: pool.lastPayout,
          pools: [pool], // add pool to new StakerPoolData[]
        })
      }

      return acc
    }, [] as StakerValidatorData[])

    return stakerValidatorData
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function callGetProtocolConstraints(validatorClient: ValidatorRegistryClient) {
  return validatorClient.send.getProtocolConstraints({ args: {} })
}

export async function fetchProtocolConstraints(
  client?: ValidatorRegistryClient,
): Promise<Constraints> {
  try {
    const validatorClient = client || (await getSimulateValidatorClient())
    return (await callGetProtocolConstraints(validatorClient)).return!
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function removeStake(
  poolAppId: bigint,
  amountToUnstake: number,
  rewardTokenId: bigint,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
  authAddr?: string,
) {
  const suggestedParams = await ParamsCache.getSuggestedParams()

  const stakingPoolSimulateClient = await getSimulateStakingPoolClient(
    poolAppId,
    activeAddress,
    authAddr,
  )

  const needsOptInTxn = rewardTokenId > 0 && !(await isOptedInToAsset(activeAddress, rewardTokenId))

  const simulateComposer = stakingPoolSimulateClient
    .newGroup()
    .gas({ args: [], note: '1', staticFee: AlgoAmount.MicroAlgos(0) })
    .gas({ args: [], note: '2', staticFee: AlgoAmount.MicroAlgos(0) })
    .removeStake({
      args: { staker: activeAddress, amountToUnstake },
      staticFee: AlgoAmount.MicroAlgos(240000),
    })

  if (needsOptInTxn) {
    const rewardTokenOptInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: activeAddress,
      to: activeAddress,
      amount: 0,
      assetIndex: Number(rewardTokenId),
      suggestedParams,
    })

    simulateComposer.addTransaction(rewardTokenOptInTxn, makeEmptyTransactionSigner(authAddr))
  }

  const simulateResult = await simulateComposer.simulate({
    allowEmptySignatures: true,
    allowUnnamedResources: true,
  })

  const feeAmount = AlgoAmount.MicroAlgos(
    1000 *
      Math.floor(
        ((simulateResult.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700,
      ) -
      2000, // subtract back out the opcodes added from the two gas calls which were paid as part of their normal fees,
  )

  let requiredBalance = feeAmount.microAlgos

  const stakingPoolClient = await getStakingPoolClient(poolAppId, signer, activeAddress)

  const composer = stakingPoolClient
    .newGroup()
    .gas({ args: [], note: '1' })
    .gas({ args: [], note: '2' })
    .removeStake({
      args: { staker: activeAddress, amountToUnstake },
      extraFee: feeAmount,
    })

  if (needsOptInTxn) {
    const rewardTokenOptInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: activeAddress,
      to: activeAddress,
      amount: 0,
      assetIndex: Number(rewardTokenId),
      suggestedParams,
    })

    requiredBalance += BigInt(rewardTokenOptInTxn.fee)

    composer.addTransaction(rewardTokenOptInTxn)
  }

  // Check balance
  await BalanceChecker.check(activeAddress, Number(requiredBalance), 'Remove stake')

  await composer.send({ populateAppCallResources: true })
}

export async function epochBalanceUpdate(
  poolAppId: bigint,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
  authAddr?: string,
): Promise<void> {
  try {
    const stakingPoolSimulateClient = await getSimulateStakingPoolClient(
      poolAppId,
      activeAddress,
      authAddr,
    )

    const simulateResult = await stakingPoolSimulateClient
      .newGroup()
      .gas({
        args: [],
        note: '1',
        staticFee: AlgoAmount.MicroAlgos(0),
        signer: makeEmptyTransactionSigner(
          'A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE',
        ),
      })
      .gas({
        args: [],
        note: '2',
        staticFee: AlgoAmount.MicroAlgos(0),
        signer: makeEmptyTransactionSigner(
          'A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE',
        ),
      })
      .epochBalanceUpdate({
        args: {},
        staticFee: AlgoAmount.MicroAlgos(240_000),
        signer: makeEmptyTransactionSigner(
          'A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE',
        ),
      })
      .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })

    const feeAmount = AlgoAmount.MicroAlgos(
      1000 *
        Math.floor(
          ((simulateResult.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700,
        ) -
        2000, // subtract back out the opcodes added from the gas call(s) which were paid as part of their normal fees,
    )

    // Check balance
    const requiredBalance = feeAmount.microAlgos
    await BalanceChecker.check(activeAddress, requiredBalance, 'Epoch balance update')

    const stakingPoolClient = await getStakingPoolClient(poolAppId, signer, activeAddress)

    await stakingPoolClient
      .newGroup()
      .gas({ args: [], note: '1' })
      .gas({ args: [], note: '2' })
      .epochBalanceUpdate({ args: {}, extraFee: feeAmount })
      .send({ populateAppCallResources: true })
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function callGetPoolInfo(
  poolKey: ValidatorPoolKey,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient.send.getPoolInfo({ args: { poolKey } })
}

export async function fetchPoolInfo(
  poolKey: ValidatorPoolKey,
  client?: ValidatorRegistryClient,
): Promise<LocalPoolInfo> {
  try {
    const validatorClient = client || (await getSimulateValidatorClient())

    const result = await callGetPoolInfo(poolKey, validatorClient)
    const poolInfo = result.return!

    const stakingPoolClient = await getSimulateStakingPoolClient(poolKey.poolAppId)
    const poolAddress = stakingPoolClient.appAddress

    return {
      poolId: poolKey.poolId,
      poolAppId: poolInfo.poolAppId,
      totalStakers: poolInfo.totalStakers,
      totalAlgoStaked: poolInfo.totalAlgoStaked,
      poolAddress,
    }
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function callGetPools(
  validatorId: number | bigint,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient.send.getPools({
    args: { validatorId },
    note: encodeCallParams('getPools', { validatorId }),
  })
}

export async function fetchValidatorPools(
  validatorId: string | number,
  client?: ValidatorRegistryClient,
): Promise<LocalPoolInfo[]> {
  try {
    const validatorClient = client || (await getSimulateValidatorClient())

    const result = await callGetPools(Number(validatorId), validatorClient)
    const poolsInfo = result.return!

    const poolAddresses: string[] = []
    const poolAlgodVersions: (string | undefined)[] = []

    for (const poolInfo of poolsInfo) {
      const stakingPoolClient = await getSimulateStakingPoolClient(poolInfo[0])

      poolAddresses.push(stakingPoolClient.appAddress)
      poolAlgodVersions.push((await stakingPoolClient.state.global.algodVer()).asString())
    }

    return poolsInfo.map((poolInfo, i) => ({
      poolId: BigInt(i + 1),
      poolAppId: poolInfo[0],
      totalStakers: poolInfo[1],
      totalAlgoStaked: poolInfo[2],
      poolAddress: poolAddresses[i],
      algodVersion: poolAlgodVersions[i],
    }))
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function claimTokens(
  pools: PoolInfo[],
  signer: algosdk.TransactionSigner,
  activeAddress: string,
  authAddr?: string,
) {
  const [algorand, stakingFactory] = getStakingPoolFactory()

  const feeComposer = algorand.newGroup()
  const simSigner = makeEmptyTransactionSigner(authAddr)

  for (const pool of pools) {
    const client = stakingFactory.getAppClientById({
      appId: pool.poolAppId,
      defaultSender: activeAddress,
      defaultSigner: simSigner,
    })
    feeComposer
      .addAppCallMethodCall(
        await client.params.gas({ args: [], note: '1', staticFee: (0).microAlgo() }),
      )
      .addAppCallMethodCall(
        await client.params.gas({ args: [], note: '2', staticFee: (0).microAlgo() }),
      )
      .addAppCallMethodCall(
        await client.params.claimTokens({ args: {}, staticFee: (240_000).microAlgo() }),
      )
  }

  const simulateResult = await feeComposer.simulate({
    allowEmptySignatures: true,
    allowUnnamedResources: true,
  })

  const feeAmount = AlgoAmount.MicroAlgos(
    1000 *
      Math.floor(
        ((simulateResult.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700,
      ) -
      2000, // subtract back out the opcodes added from the gas call(s) which were paid as part of their normal fees,
  )

  const composer = algorand.newGroup()

  for (const pool of pools) {
    const client = stakingFactory.getAppClientById({
      appId: pool.poolAppId,
      // Assumes this address was registered already with the AlgorandClient and the use-wallet signer
      defaultSender: activeAddress,
      defaultSigner: signer,
    })
    composer
      .addAppCallMethodCall(await client.params.gas({ args: [], note: '1' }))
      .addAppCallMethodCall(await client.params.gas({ args: [], note: '2' }))
      .addAppCallMethodCall(await client.params.claimTokens({ args: {}, extraFee: feeAmount }))
  }

  await composer.send({ populateAppCallResources: true })
}

export async function fetchStakedInfoForPool(poolAppId: bigint): Promise<StakedInfo[]> {
  try {
    const stakingPoolClient = await getSimulateStakingPoolClient(poolAppId)
    const stakers = await stakingPoolClient.state.box.stakers()
    return stakers!
      .map((s): StakedInfo => StakedInfoFromTuple(s))
      .filter((staker) => staker.account !== ALGORAND_ZERO_ADDRESS_STRING)
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function changeValidatorManager(
  validatorId: number | bigint,
  manager: string,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
) {
  const validatorClient = await getValidatorClient(signer, activeAddress)

  // Check balance
  await BalanceChecker.check(activeAddress, 1000, 'Change validator manager')

  validatorClient.send.changeValidatorManager({
    args: { validatorId, manager },
    populateAppCallResources: true,
  })
}

export async function changeValidatorSunsetInfo(
  validatorId: number | bigint,
  sunsettingOn: number,
  sunsettingTo: number,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
) {
  const validatorClient = await getValidatorClient(signer, activeAddress)

  // Check balance
  await BalanceChecker.check(activeAddress, 1000, 'Change validator sunset info')

  return validatorClient.send.changeValidatorSunsetInfo({
    args: { validatorId, sunsettingOn, sunsettingTo },
    populateAppCallResources: true,
  })
}

export async function changeValidatorNfd(
  validatorId: number | bigint,
  nfdAppId: bigint,
  nfdName: string,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
) {
  const validatorClient = await getValidatorClient(signer, activeAddress)

  // Check balance
  await BalanceChecker.check(activeAddress, 1000, 'Change validator NFD')

  return validatorClient.send.changeValidatorNfd({
    args: { validatorId, nfdAppId, nfdName },
    extraFee: AlgoAmount.MicroAlgos(1000),
    populateAppCallResources: true,
  })
}

export async function changeValidatorCommissionAddress(
  validatorId: number | bigint,
  commissionAddress: string,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
) {
  const validatorClient = await getValidatorClient(signer, activeAddress)

  // Check balance
  await BalanceChecker.check(activeAddress, 1000, 'Change validator commission address')

  return validatorClient.send.changeValidatorCommissionAddress({
    args: { validatorId, commissionAddress },
    populateAppCallResources: true,
  })
}

export async function changeValidatorRewardInfo(
  validatorId: number | bigint,
  entryGatingType: number,
  entryGatingAddress: string,
  entryGatingAssets: EntryGatingAssets,
  gatingAssetMinBalance: number | bigint,
  rewardPerPayout: number | bigint,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
) {
  const validatorClient = await getValidatorClient(signer, activeAddress)

  // Check balance
  await BalanceChecker.check(activeAddress, 1000, 'Change validator reward info')

  return validatorClient.send.changeValidatorRewardInfo({
    args: {
      validatorId,
      entryGatingType,
      entryGatingAddress,
      entryGatingAssets,
      gatingAssetMinBalance,
      rewardPerPayout,
    },
    populateAppCallResources: true,
  })
}

export async function fetchPoolApy(poolAppId: bigint): Promise<number> {
  try {
    const stakingPoolClient = await getSimulateStakingPoolClient(poolAppId)
    const ewma = await stakingPoolClient.state.global.weightedMovingAverage()

    if (!ewma) {
      throw new Error(`Error fetching EWMA for pool ${poolAppId}`)
    }
    const poolApy = Number(ewma) / 10000

    return poolApy
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function linkPoolToNfd(
  poolAppId: bigint,
  nfdName: string,
  nfdAppId: number,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
) {
  try {
    const nfdAppAddress = algosdk.getApplicationAddress(nfdAppId)
    const poolAppAddress = algosdk.getApplicationAddress(poolAppId)

    const boxStorageMbrAmount = AlgoAmount.MicroAlgos(20500)
    const feeAmount = AlgoAmount.MicroAlgos(5000)

    const payBoxStorageMbrTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: activeAddress,
      to: nfdAppAddress,
      amount: boxStorageMbrAmount.microAlgos,
      suggestedParams: await ParamsCache.getSuggestedParams(),
    })

    const updateNfdAppCall = algosdk.makeApplicationNoOpTxnFromObject({
      appIndex: nfdAppId,
      from: activeAddress,
      suggestedParams: await ParamsCache.getSuggestedParams(),
      ...algokit.getAppArgsForTransaction({
        appArgs: [
          new TextEncoder().encode('update_field'),
          new TextEncoder().encode('u.cav.algo.a'),
          algosdk.decodeAddress(poolAppAddress).publicKey,
        ],
      }),
    })

    // Check balance
    const requiredBalance =
      BigInt(payBoxStorageMbrTxn.amount) +
      BigInt(payBoxStorageMbrTxn.fee) +
      BigInt(updateNfdAppCall.fee) +
      feeAmount.microAlgos

    await BalanceChecker.check(activeAddress, requiredBalance, 'Link pool to NFD')

    const stakingPoolClient = await getStakingPoolClient(poolAppId, signer, activeAddress)

    await stakingPoolClient
      .newGroup()
      .addTransaction(payBoxStorageMbrTxn)
      .addTransaction(updateNfdAppCall)
      .linkToNfd({ args: { nfdAppId, nfdName }, extraFee: feeAmount })
      .send({ populateAppCallResources: true })
  } catch (error) {
    console.error(error)
    throw error
  }
}
