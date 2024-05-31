import * as algokit from '@algorandfoundation/algokit-utils'
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { QueryClient } from '@tanstack/react-query'
import algosdk from 'algosdk'
import { fetchAsset, isOptedInToAsset } from '@/api/algod'
import {
  getSimulateStakingPoolClient,
  getSimulateValidatorClient,
  getStakingPoolClient,
  getValidatorClient,
} from '@/api/clients'
import { fetchNfd } from '@/api/nfd'
import { ALGORAND_ZERO_ADDRESS_STRING } from '@/constants/accounts'
import { GatingType } from '@/constants/gating'
import { StakingPoolClient } from '@/contracts/StakingPoolClient'
import { ValidatorRegistryClient } from '@/contracts/ValidatorRegistryClient'
import { Asset } from '@/interfaces/algod'
import { StakedInfo, StakerPoolData, StakerValidatorData } from '@/interfaces/staking'
import {
  Constraints,
  EntryGatingAssets,
  FindPoolForStakerResponse,
  MbrAmounts,
  NodePoolAssignmentConfig,
  PoolInfo,
  RawConstraints,
  RawNodePoolAssignmentConfig,
  RawPoolsInfo,
  RawValidatorConfig,
  RawValidatorState,
  Validator,
  ValidatorConfig,
  ValidatorConfigInput,
  ValidatorPoolKey,
} from '@/interfaces/validator'
import { makeEmptyTransactionSigner } from '@/lib/makeEmptyTransactionSigner'
import { BalanceChecker } from '@/utils/balanceChecker'
import { chunkBytes } from '@/utils/bytes'
import {
  transformNodePoolAssignment,
  transformStakedInfo,
  transformValidatorData,
} from '@/utils/contracts'
import { dayjs } from '@/utils/dayjs'
import { getAlgodConfigFromViteEnvironment } from '@/utils/network/getAlgoClientConfigs'
import { ParamsCache } from '@/utils/paramsCache'
import { encodeCallParams } from '@/utils/tests/abi'

const algodConfig = getAlgodConfigFromViteEnvironment()
const algodClient = algokit.getAlgoClient({
  server: algodConfig.server,
  port: algodConfig.port,
  token: algodConfig.token,
})

export function callGetNumValidators(validatorClient: ValidatorRegistryClient) {
  return validatorClient
    .compose()
    .getNumValidators({})
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export function callGetValidatorConfig(
  validatorId: number | bigint,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient
    .compose()
    .getValidatorConfig({ validatorId })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export function callGetValidatorState(
  validatorId: number | bigint,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient
    .compose()
    .getValidatorState({ validatorId })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

/**
 * Fetches the validator's configuration, state, pools info, node pool assignments, reward token
 * (if one is configured), NFD for info, and APY for all pools. When this is called by the
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

    const rawConfig = config.returns?.[0] as RawValidatorConfig
    const rawState = state.returns?.[0] as RawValidatorState
    const rawPoolsInfo = validatorPoolData.returns?.[0] as RawPoolsInfo
    const rawNodePoolAssignment = nodePoolAssignments.returns?.[0] as RawNodePoolAssignmentConfig

    if (!rawConfig || !rawState || !rawPoolsInfo || !rawNodePoolAssignment) {
      throw new ValidatorNotFoundError(`Validator with id "${Number(validatorId)}" not found!`)
    }

    // Transform raw data to Validator object
    const validator: Validator = transformValidatorData(
      rawConfig,
      rawState,
      rawPoolsInfo,
      rawNodePoolAssignment,
    )

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

    const poolApyPromises = validator.pools.map(async (pool) => {
      const poolApy = await fetchPoolApy(pool.poolAppId)
      // Seed the query cache with the pool APY data
      queryClient?.setQueryData(['pool-apy', pool.poolAppId], poolApy)

      return poolApy
    })

    const poolApys = await Promise.all(poolApyPromises)
    const avgApy = poolApys.reduce((acc, apy) => acc + apy, 0) / (poolApys.length || 1)

    validator.apy = avgApy

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

    const numValidators = numValidatorsResponse.returns![0]

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
  nfdAppId: number,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
  authAddr?: string,
) {
  const validatorClient = await getValidatorClient(signer, activeAddress)

  const validatorAppRef = await validatorClient.appClient.getAppReference()

  const [validatorMbr] = (
    await validatorClient
      .compose()
      .getMbrAmounts(
        {},
        {
          sender: {
            addr: activeAddress as string,
            signer: makeEmptyTransactionSigner(authAddr),
          },
        },
      )
      .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
  ).returns![0]

  const params = await ParamsCache.getSuggestedParams()

  const suggestedParams = {
    ...params,
    flatFee: true,
    fee: AlgoAmount.Algos(10.001).microAlgos,
  }

  const payValidatorMbr = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: activeAddress,
    to: validatorAppRef.appAddress,
    amount: Number(validatorMbr),
    suggestedParams,
  })

  // Check balance
  const requiredBalance = Number(payValidatorMbr.amount) + payValidatorMbr.fee + 1000
  await BalanceChecker.check(activeAddress, requiredBalance, 'Add validator')

  const entryGatingType = Number(values.entryGatingType || 0)
  const entryGatingAddress = values.entryGatingAddress || ALGORAND_ZERO_ADDRESS_STRING
  const entryGatingAssets = new Array(4).fill(0) as EntryGatingAssets

  for (let i = 0; i < values.entryGatingAssets.length && i < 4; i++) {
    entryGatingAssets[i] = Number(values.entryGatingAssets[i] || 0)
  }

  const validatorConfig: ValidatorConfig = {
    id: 0, // id not known yet
    owner: values.owner,
    manager: values.manager,
    nfdForInfo: nfdAppId,
    entryGatingType,
    entryGatingAddress,
    entryGatingAssets,
    gatingAssetMinBalance: BigInt(values.gatingAssetMinBalance || 0),
    rewardTokenId: Number(values.rewardTokenId || 0),
    rewardPerPayout: BigInt(values.rewardPerPayout || 0),
    epochRoundLength: Number(values.epochRoundLength),
    percentToValidator: Number(values.percentToValidator) * 10000,
    validatorCommissionAddress: values.validatorCommissionAddress,
    minEntryStake: BigInt(AlgoAmount.Algos(Number(values.minEntryStake)).microAlgos),
    maxAlgoPerPool: BigInt(0),
    poolsPerNode: Number(values.poolsPerNode),
    sunsettingOn: Number(0),
    sunsettingTo: Number(0),
  }

  const result = await validatorClient
    .compose()
    .addValidator(
      {
        mbrPayment: {
          transaction: payValidatorMbr,
          signer: {
            signer,
            addr: activeAddress,
          } as TransactionSignerAccount,
        },
        nfdName: values.nfdForInfo || '',
        config: [
          validatorConfig.id,
          validatorConfig.owner,
          validatorConfig.manager,
          validatorConfig.nfdForInfo,
          validatorConfig.entryGatingType,
          validatorConfig.entryGatingAddress,
          validatorConfig.entryGatingAssets,
          validatorConfig.gatingAssetMinBalance,
          validatorConfig.rewardTokenId,
          validatorConfig.rewardPerPayout,
          validatorConfig.epochRoundLength,
          validatorConfig.percentToValidator,
          validatorConfig.validatorCommissionAddress,
          validatorConfig.minEntryStake,
          validatorConfig.maxAlgoPerPool,
          validatorConfig.poolsPerNode,
          validatorConfig.sunsettingOn,
          validatorConfig.sunsettingTo,
        ],
      },
      {},
    )
    .execute({ populateAppCallResources: true })

  const validatorId = Number(result.returns![0])

  return validatorId
}

export function callGetNodePoolAssignments(
  validatorId: number | bigint,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient
    .compose()
    .getNodePoolAssignments({ validatorId })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export async function fetchNodePoolAssignments(
  validatorId: string | number | bigint,
): Promise<NodePoolAssignmentConfig> {
  try {
    const validatorClient = await getSimulateValidatorClient()

    const nodePoolAssignmentResponse = await callGetNodePoolAssignments(
      Number(validatorId),
      validatorClient,
    )

    const rawNodePoolAssignmentConfig: RawNodePoolAssignmentConfig | undefined =
      nodePoolAssignmentResponse.returns![0]

    if (!rawNodePoolAssignmentConfig) {
      throw new Error('No node pool assignment found')
    }

    const nodePoolAssignmentConfig = transformNodePoolAssignment(rawNodePoolAssignmentConfig)
    return nodePoolAssignmentConfig
  } catch (error) {
    console.error(error)
    throw error
  }
}

export function callGetMbrAmounts(validatorClient: ValidatorRegistryClient) {
  return validatorClient
    .compose()
    .getMbrAmounts({})
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export async function fetchMbrAmounts(client?: ValidatorRegistryClient): Promise<MbrAmounts> {
  try {
    const validatorClient = client || (await getSimulateValidatorClient())

    const mbrAmountsResponse = await callGetMbrAmounts(validatorClient)
    const [validatorMbr, poolMbr, poolInitMbr, stakerMbr] = mbrAmountsResponse.returns![0]

    return {
      validatorMbr: Number(validatorMbr),
      poolMbr: Number(poolMbr),
      poolInitMbr: Number(poolInitMbr),
      stakerMbr: Number(stakerMbr),
    }
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function addStakingPool(
  validatorId: number,
  nodeNum: number,
  poolMbr: number,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
): Promise<ValidatorPoolKey> {
  const validatorClient = await getValidatorClient(signer, activeAddress)

  const validatorAppRef = await validatorClient.appClient.getAppReference()
  const suggestedParams = await ParamsCache.getSuggestedParams()

  const payValidatorAddPoolMbr = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: activeAddress,
    to: validatorAppRef.appAddress,
    amount: poolMbr,
    suggestedParams,
  })

  // Check balance
  const requiredBalance =
    Number(payValidatorAddPoolMbr.amount) + payValidatorAddPoolMbr.fee + 1000 + 1000 + 2000
  await BalanceChecker.check(activeAddress, requiredBalance, 'Add staking pool')

  const addPoolResponse = await validatorClient
    .compose()
    .gas({}, { note: '1' })
    .gas({}, { note: '2' })
    .addPool(
      {
        mbrPayment: {
          transaction: payValidatorAddPoolMbr,
          signer: { signer, addr: activeAddress } as TransactionSignerAccount,
        },
        validatorId,
        nodeNum,
      },
      {
        sendParams: {
          fee: AlgoAmount.MicroAlgos(2000),
        },
      },
    )
    .execute({ populateAppCallResources: true })

  const [valId, poolId, poolAppId] = addPoolResponse.returns![2]

  const stakingPool: ValidatorPoolKey = {
    poolId: Number(poolId),
    poolAppId: Number(poolAppId),
    validatorId: Number(valId),
  }

  return stakingPool
}

export async function initStakingPoolStorage(
  poolAppId: number,
  poolInitMbr: number,
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
    .compose()
    .gas({}, { note: '1' })
    .gas({}, { note: '2' })
    .initStorage(
      {
        mbrPayment: {
          transaction: payPoolInitStorageMbr,
          signer: { signer, addr: activeAddress } as TransactionSignerAccount,
        },
      },
      { sendParams: { fee: AlgoAmount.MicroAlgos(3000) } },
    )
    .execute({ populateAppCallResources: true })
}

export async function doesStakerNeedToPayMbr(
  activeAddress: string,
  authAddr?: string,
  client?: ValidatorRegistryClient,
): Promise<boolean> {
  const validatorClient = client || (await getSimulateValidatorClient(activeAddress, authAddr))

  const result = await validatorClient
    .compose()
    .doesStakerNeedToPayMbr({
      staker: activeAddress,
    })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })

  if (result.returns?.[0] === undefined) {
    throw new Error('Error checking if staker needs to pay MBR')
  }
  return result.returns[0]
}

export async function findPoolForStaker(
  validatorId: number,
  amountToStake: number,
  activeAddress: string,
  authAddr?: string,
  client?: ValidatorRegistryClient,
): Promise<FindPoolForStakerResponse> {
  const validatorClient = client || (await getSimulateValidatorClient(activeAddress, authAddr))

  const result = await validatorClient
    .compose()
    .gas({})
    .findPoolForStaker(
      {
        validatorId,
        staker: activeAddress,
        amountToStake,
      },
      {
        sendParams: {
          fee: AlgoAmount.MicroAlgos(2000),
        },
      },
    )
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })

  const errorMessage = result.simulateResponse.txnGroups[0].failureMessage

  if (errorMessage || !result.returns[1]) {
    throw new Error(`Error finding pool for staker: ${errorMessage || 'No pool found'}`)
  }

  const [[valId, poolId, poolAppId], isNewStakerToValidator, isNewStakerToProtocol] =
    result.returns[1]

  const poolKey: ValidatorPoolKey = {
    validatorId: Number(valId),
    poolId: Number(poolId),
    poolAppId: Number(poolAppId),
  }

  return { poolKey, isNewStakerToValidator, isNewStakerToProtocol }
}

export async function addStake(
  validatorId: number,
  stakeAmount: number, // microalgos
  valueToVerify: number,
  rewardTokenId: number,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
  authAddr?: string,
): Promise<ValidatorPoolKey> {
  const validatorClient = await getValidatorClient(signer, activeAddress)

  const validatorAppRef = await validatorClient.appClient.getAppReference()
  const suggestedParams = await ParamsCache.getSuggestedParams()

  const stakeTransferPayment = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: activeAddress,
    to: validatorAppRef.appAddress,
    amount: stakeAmount,
    suggestedParams,
  })

  const needsOptInTxn = rewardTokenId > 0 && !(await isOptedInToAsset(activeAddress, rewardTokenId))

  const simulateValidatorClient = await getSimulateValidatorClient(activeAddress, authAddr)

  const simulateComposer = simulateValidatorClient
    .compose()
    .gas({}, { note: '1', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
    .gas({}, { note: '2', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
    .addStake(
      {
        stakedAmountPayment: {
          transaction: stakeTransferPayment,
          signer: { addr: activeAddress, signer: makeEmptyTransactionSigner(authAddr) },
        },
        validatorId,
        valueToVerify,
      },
      { sendParams: { fee: AlgoAmount.MicroAlgos(240_000) } },
    )

  if (needsOptInTxn) {
    const rewardTokenOptInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: activeAddress,
      to: activeAddress,
      amount: 0,
      assetIndex: rewardTokenId,
      suggestedParams,
    })

    simulateComposer.addTransaction(rewardTokenOptInTxn)
  }

  const simulateResults = await simulateComposer.simulate({
    allowEmptySignatures: true,
    allowUnnamedResources: true,
  })

  stakeTransferPayment.group = undefined

  // @todo: switch to Joe's new method(s)
  const feeAmount = AlgoAmount.MicroAlgos(
    3000 + 1000 * ((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) / 700),
  )

  let requiredBalance =
    Number(stakeTransferPayment.amount) + stakeTransferPayment.fee + feeAmount.microAlgos

  const composer = validatorClient
    .compose()
    .gas({}, { note: '1', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
    .gas({}, { note: '2', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
    .addStake(
      {
        stakedAmountPayment: {
          transaction: stakeTransferPayment,
          signer: { signer, addr: activeAddress } as TransactionSignerAccount,
        },
        validatorId,
        valueToVerify,
      },
      { sendParams: { fee: feeAmount } },
    )

  if (needsOptInTxn) {
    const rewardTokenOptInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: activeAddress,
      to: activeAddress,
      amount: 0,
      assetIndex: rewardTokenId,
      suggestedParams,
    })

    requiredBalance += rewardTokenOptInTxn.fee

    composer.addTransaction(rewardTokenOptInTxn)
  }

  // Check balance
  await BalanceChecker.check(activeAddress, requiredBalance, 'Add stake')

  const result = await composer.execute({ populateAppCallResources: true })

  const [valId, poolId, poolAppId] = result.returns![2]

  return {
    poolId: Number(poolId),
    poolAppId: Number(poolAppId),
    validatorId: Number(valId),
  }
}

export async function callFindPoolForStaker(
  validatorId: number | bigint,
  staker: string,
  amountToStake: number | bigint,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient
    .compose()
    .findPoolForStaker({ validatorId, staker, amountToStake })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export async function isNewStakerToValidator(
  validatorId: number | bigint,
  staker: string,
  minEntryStake: number | bigint,
) {
  const validatorClient = await getSimulateValidatorClient()
  const result = await callFindPoolForStaker(validatorId, staker, minEntryStake, validatorClient)

  const [_, isNewStaker] = result.returns![0]

  return isNewStaker
}

export async function callGetStakedPoolsForAccount(
  staker: string,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient
    .compose()
    .getStakedPoolsForAccount({ staker })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export async function fetchStakedPoolsForAccount(staker: string): Promise<ValidatorPoolKey[]> {
  try {
    const validatorClient = await getSimulateValidatorClient()
    const result = await callGetStakedPoolsForAccount(staker, validatorClient)

    const stakedPools = result.returns![0]

    // Filter out potential duplicates (temporary UI fix for duplicate staked pools bug)
    const uniqueStakedPools = Array.from(
      new Set(stakedPools.map((sp) => JSON.stringify(sp.map((v) => Number(v))))),
    ).map((sp) => JSON.parse(sp) as (typeof stakedPools)[0])

    return uniqueStakedPools.map(([validatorId, poolId, poolAppId]) => ({
      validatorId: Number(validatorId),
      poolId: Number(poolId),
      poolAppId: Number(poolAppId),
    }))
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function callGetStakerInfo(staker: string, stakingPoolClient: StakingPoolClient) {
  return stakingPoolClient
    .compose()
    .getStakerInfo({ staker })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export async function fetchStakerPoolData(
  poolKey: ValidatorPoolKey,
  staker: string,
): Promise<StakerPoolData> {
  try {
    const stakingPoolClient = await getSimulateStakingPoolClient(poolKey.poolAppId)
    const stakingPoolGS = await stakingPoolClient.appClient.getGlobalState()

    let lastPayoutTime = dayjs()

    if (stakingPoolGS.lastPayout !== undefined) {
      lastPayoutTime = dayjs.unix(Number(stakingPoolGS.lastPayout.value))
    }

    const result = await callGetStakerInfo(staker, stakingPoolClient)

    const [account, balance, totalRewarded, rewardTokenBalance, entryTime] = result.returns![0]

    const stakedInfo: StakedInfo = {
      account,
      balance,
      totalRewarded,
      rewardTokenBalance,
      entryRound: Number(entryTime),
    }

    return {
      ...stakedInfo,
      poolKey,
      lastPayout: lastPayoutTime.unix(),
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
      const { validatorId } = pool.poolKey

      // Check if we already have an entry for this validator
      const existingData = acc.find((data) => data.validatorId === validatorId)

      if (existingData) {
        // staker is in another pool for this validator, update validator totals
        existingData.balance += pool.balance
        existingData.totalRewarded += pool.totalRewarded
        existingData.rewardTokenBalance += pool.rewardTokenBalance
        existingData.entryTime = Math.max(existingData.entryTime, pool.entryRound)
        existingData.lastPayout = Math.max(existingData.lastPayout, pool.lastPayout)
        existingData.pools.push(pool) // add pool to existing StakerPoolData[]
      } else {
        // First pool for this validator, add new entry
        acc.push({
          validatorId,
          balance: pool.balance,
          totalRewarded: pool.totalRewarded,
          rewardTokenBalance: pool.rewardTokenBalance,
          entryTime: pool.entryRound,
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
  return validatorClient
    .compose()
    .getProtocolConstraints({})
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export async function fetchProtocolConstraints(
  client?: ValidatorRegistryClient,
): Promise<Constraints> {
  try {
    const validatorClient = client || (await getSimulateValidatorClient())

    const result = await callGetProtocolConstraints(validatorClient)

    const [
      payoutMinsMin,
      payoutMinsMax,
      commissionPctMin,
      commissionPctMax,
      minEntryStake,
      maxAlgoPerPool,
      maxAlgoPerValidator,
      saturationThreshold,
      maxNodes,
      maxPoolsPerNode,
      maxStakersPerPool,
    ] = result.returns![0] as RawConstraints

    return {
      payoutRoundsMin: Number(payoutMinsMin),
      payoutRoundsMax: Number(payoutMinsMax),
      commissionPctMin: Number(commissionPctMin),
      commissionPctMax: Number(commissionPctMax),
      minEntryStake,
      maxAlgoPerPool,
      maxAlgoPerValidator,
      saturationThreshold,
      maxNodes: Number(maxNodes),
      maxPoolsPerNode: Number(maxPoolsPerNode),
      maxStakersPerPool: Number(maxStakersPerPool),
    }
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function removeStake(
  poolAppId: number | bigint,
  amountToUnstake: number,
  rewardTokenId: number,
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
    .compose()
    .gas({}, { note: '1', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
    .gas({}, { note: '2', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
    .removeStake(
      {
        staker: activeAddress,
        amountToUnstake,
      },
      { sendParams: { fee: AlgoAmount.MicroAlgos(240_000) } },
    )

  if (needsOptInTxn) {
    const rewardTokenOptInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: activeAddress,
      to: activeAddress,
      amount: 0,
      assetIndex: rewardTokenId,
      suggestedParams,
    })

    simulateComposer.addTransaction(rewardTokenOptInTxn)
  }

  const simulateResult = await simulateComposer.simulate({
    allowEmptySignatures: true,
    allowUnnamedResources: true,
  })

  // @todo: switch to Joe's new method(s)
  const feeAmount = AlgoAmount.MicroAlgos(
    1000 *
      Math.floor(
        ((simulateResult.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700,
      ),
  )

  let requiredBalance = feeAmount.microAlgos

  const stakingPoolClient = await getStakingPoolClient(poolAppId, signer, activeAddress)

  const composer = stakingPoolClient
    .compose()
    .gas({}, { note: '1', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
    .gas({}, { note: '2', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
    .removeStake(
      {
        staker: activeAddress,
        amountToUnstake,
      },
      { sendParams: { fee: feeAmount } },
    )

  if (needsOptInTxn) {
    const rewardTokenOptInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: activeAddress,
      to: activeAddress,
      amount: 0,
      assetIndex: rewardTokenId,
      suggestedParams,
    })

    requiredBalance += rewardTokenOptInTxn.fee

    composer.addTransaction(rewardTokenOptInTxn)
  }

  // Check balance
  await BalanceChecker.check(activeAddress, requiredBalance, 'Remove stake')

  await composer.execute({ populateAppCallResources: true })
}

export async function epochBalanceUpdate(
  poolAppId: number | bigint,
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
      .compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .epochBalanceUpdate({}, { sendParams: { fee: AlgoAmount.MicroAlgos(240_000) } })
      .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })

    // @todo: switch to Joe's new method(s)
    const feeAmount = AlgoAmount.MicroAlgos(
      3000 + 1000 * ((simulateResult.simulateResponse.txnGroups[0].appBudgetAdded as number) / 700),
    )

    // Check balance
    const requiredBalance = feeAmount.microAlgos
    await BalanceChecker.check(activeAddress, requiredBalance, 'Epoch balance update')

    const stakingPoolClient = await getStakingPoolClient(poolAppId, signer, activeAddress)

    await stakingPoolClient
      .compose()
      .gas({}, { note: '1', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
      .gas({}, { note: '2', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
      .epochBalanceUpdate({}, { sendParams: { fee: feeAmount } })
      .execute({ populateAppCallResources: true })
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function callGetPoolInfo(
  poolKey: ValidatorPoolKey,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient
    .compose()
    .getPoolInfo({ poolKey: [poolKey.validatorId, poolKey.poolId, poolKey.poolAppId] })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export async function fetchPoolInfo(
  poolKey: ValidatorPoolKey,
  client?: ValidatorRegistryClient,
): Promise<PoolInfo> {
  try {
    const validatorClient = client || (await getSimulateValidatorClient())

    const result = await callGetPoolInfo(poolKey, validatorClient)

    const [poolAppId, totalStakers, totalAlgoStaked] = result.returns![0]

    const stakingPoolClient = await getSimulateStakingPoolClient(poolAppId)
    const poolAppRef = await stakingPoolClient.appClient.getAppReference()
    const poolAddress = poolAppRef.appAddress

    return {
      poolId: poolKey.poolId,
      poolAppId: Number(poolAppId),
      totalStakers: Number(totalStakers),
      totalAlgoStaked,
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
  return validatorClient
    .compose()
    .getPools({ validatorId }, { note: encodeCallParams('getPools', { validatorId }) })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export async function fetchValidatorPools(
  validatorId: string | number,
  client?: ValidatorRegistryClient,
): Promise<PoolInfo[]> {
  try {
    const validatorClient = client || (await getSimulateValidatorClient())

    const result = await callGetPools(Number(validatorId), validatorClient)

    const poolsInfo = result.returns![0]

    const poolAddresses: string[] = []
    const poolAlgodVersions: (string | undefined)[] = []

    for (const poolInfo of poolsInfo) {
      const stakingPoolClient = await getSimulateStakingPoolClient(poolInfo[0])

      const poolAppRef = await stakingPoolClient.appClient.getAppReference()
      const poolAddress = poolAppRef.appAddress
      poolAddresses.push(poolAddress)

      const stakingPoolGS = await stakingPoolClient.appClient.getGlobalState()
      const algodVersion = stakingPoolGS.algodVer?.value as string | undefined
      poolAlgodVersions.push(algodVersion)
    }

    return poolsInfo.map(([poolAppId, totalStakers, totalAlgoStaked], i) => ({
      poolId: i + 1,
      poolAppId: Number(poolAppId),
      totalStakers: Number(totalStakers),
      totalAlgoStaked,
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
  const atc1 = new algosdk.AtomicTransactionComposer()

  for (const pool of pools) {
    const client = await getSimulateStakingPoolClient(pool.poolAppId, activeAddress, authAddr)
    await client.gas({}, { note: '1', sendParams: { atc: atc1, fee: AlgoAmount.MicroAlgos(0) } })
    await client.gas({}, { note: '2', sendParams: { atc: atc1, fee: AlgoAmount.MicroAlgos(0) } })
    await client.claimTokens({}, { sendParams: { atc: atc1, fee: AlgoAmount.MicroAlgos(240_000) } })
  }

  const simulateResult = await atc1.simulate(
    algodClient,
    new algosdk.modelsv2.SimulateRequest({
      txnGroups: [],
      allowEmptySignatures: true,
      allowUnnamedResources: true,
    }),
  )

  // @todo: switch to Joe's new method(s)
  const feeAmount = AlgoAmount.MicroAlgos(
    1000 *
      Math.floor(
        ((simulateResult.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700,
      ),
  )

  const atc2 = new algosdk.AtomicTransactionComposer()

  for (const pool of pools) {
    const client = await getStakingPoolClient(pool.poolAppId, signer, activeAddress)
    await client.gas({}, { note: '1', sendParams: { atc: atc2, fee: AlgoAmount.MicroAlgos(0) } })
    await client.gas({}, { note: '2', sendParams: { atc: atc2, fee: AlgoAmount.MicroAlgos(0) } })
    await client.claimTokens({}, { sendParams: { atc: atc2, fee: feeAmount } })
  }

  await algokit.sendAtomicTransactionComposer(
    { atc: atc2, sendParams: { populateAppCallResources: true } },
    algodClient,
  )
}

export async function fetchStakedInfoForPool(poolAppId: number): Promise<StakedInfo[]> {
  try {
    const stakingPoolClient = await getSimulateStakingPoolClient(poolAppId)
    const boxValue = await stakingPoolClient.appClient.getBoxValue('stakers')

    const stakersInfo = chunkBytes(boxValue)
      .map((stakerData) => transformStakedInfo(stakerData))
      .filter((staker) => staker.account !== ALGORAND_ZERO_ADDRESS_STRING)

    return stakersInfo
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

  return validatorClient
    .compose()
    .changeValidatorManager({ validatorId, manager })
    .execute({ populateAppCallResources: true })
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

  return validatorClient
    .compose()
    .changeValidatorSunsetInfo({ validatorId, sunsettingOn, sunsettingTo })
    .execute({ populateAppCallResources: true })
}

export async function changeValidatorNfd(
  validatorId: number | bigint,
  nfdAppId: number,
  nfdName: string,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
) {
  const validatorClient = await getValidatorClient(signer, activeAddress)

  // Check balance
  await BalanceChecker.check(activeAddress, 1000, 'Change validator NFD')

  return validatorClient
    .compose()
    .changeValidatorNfd(
      { validatorId, nfdAppId, nfdName },
      { sendParams: { fee: AlgoAmount.MicroAlgos(2000) } },
    )
    .execute({ populateAppCallResources: true })
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

  return validatorClient
    .compose()
    .changeValidatorCommissionAddress({ validatorId, commissionAddress })
    .execute({ populateAppCallResources: true })
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

  return validatorClient
    .compose()
    .changeValidatorRewardInfo({
      validatorId,
      entryGatingType,
      entryGatingAddress,
      entryGatingAssets,
      gatingAssetMinBalance,
      rewardPerPayout,
    })
    .execute({ populateAppCallResources: true })
}

export async function fetchPoolApy(poolAppId: number): Promise<number> {
  try {
    const stakingPoolClient = await getSimulateStakingPoolClient(poolAppId)
    const stakingPoolGS = await stakingPoolClient.getGlobalState()

    const ewmaBytes = stakingPoolGS.ewma?.asByteArray()

    if (!ewmaBytes) {
      throw new Error(`Error fetching EWMA for pool ${poolAppId}`)
    }

    const ewma = algosdk.bytesToBigInt(ewmaBytes)

    const poolApy = Number(ewma) / 10000

    return poolApy
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function linkPoolToNfd(
  poolAppId: number,
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
      Number(payBoxStorageMbrTxn.amount) +
      payBoxStorageMbrTxn.fee +
      updateNfdAppCall.fee +
      feeAmount.microAlgos

    await BalanceChecker.check(activeAddress, requiredBalance, 'Link pool to NFD')

    const stakingPoolClient = await getStakingPoolClient(poolAppId, signer, activeAddress)

    await stakingPoolClient
      .compose()
      .addTransaction(payBoxStorageMbrTxn)
      .addTransaction(updateNfdAppCall)
      .linkToNfd(
        { nfdAppId, nfdName },
        {
          sendParams: {
            fee: feeAmount,
          },
        },
      )
      .execute({ populateAppCallResources: true })
  } catch (error) {
    console.error(error)
    throw error
  }
}
