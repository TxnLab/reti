import * as algokit from '@algorandfoundation/algokit-utils'
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { queryOptions } from '@tanstack/react-query'
import algosdk from 'algosdk'
import { StakingPoolClient } from '@/contracts/StakingPoolClient'
import { ValidatorRegistryClient } from '@/contracts/ValidatorRegistryClient'
import { StakedInfo, StakerPoolData, StakerValidatorData } from '@/interfaces/staking'
import {
  Constraints,
  MbrAmounts,
  NodePoolAssignmentConfig,
  PoolInfo,
  RawConstraints,
  RawNodePoolAssignmentConfig,
  Validator,
  ValidatorConfigRaw,
  ValidatorPoolKey,
  ValidatorStateRaw,
} from '@/interfaces/validator'
import {
  transformNodePoolAssignment,
  transformValidatorConfig,
  transformValidatorData,
} from '@/utils/contracts'
import { getAlgodConfigFromViteEnvironment } from '@/utils/network/getAlgoClientConfigs'
import {
  getNfdRegistryAppIdFromViteEnvironment,
  getRetiAppIdFromViteEnvironment,
} from '@/utils/env'
import { getActiveWalletAddress } from '@/utils/wallets'

const algodConfig = getAlgodConfigFromViteEnvironment()
const algodClient = algokit.getAlgoClient({
  server: algodConfig.server,
  port: algodConfig.port,
  token: algodConfig.token,
})

const RETI_APP_ID = getRetiAppIdFromViteEnvironment()
const NFD_REGISTRY_APP_ID = getNfdRegistryAppIdFromViteEnvironment()

const makeSimulateValidatorClient = (activeAddress: string) => {
  return new ValidatorRegistryClient(
    {
      sender: { addr: activeAddress, signer: algosdk.makeEmptyTransactionSigner() },
      resolveBy: 'id',
      id: RETI_APP_ID,
      deployTimeParams: {
        NFDRegistryAppID: NFD_REGISTRY_APP_ID,
      },
    },
    algodClient,
  )
}

const makeValidatorClient = (signer: algosdk.TransactionSigner, activeAddress: string) => {
  return new ValidatorRegistryClient(
    {
      sender: { signer, addr: activeAddress } as TransactionSignerAccount,
      resolveBy: 'id',
      id: RETI_APP_ID,
      deployTimeParams: {
        NFDRegistryAppID: NFD_REGISTRY_APP_ID,
      },
    },
    algodClient,
  )
}

const makeSimulateStakingPoolClient = (poolAppId: number | bigint, activeAddress: string) => {
  return new StakingPoolClient(
    {
      sender: { addr: activeAddress, signer: algosdk.makeEmptyTransactionSigner() },
      resolveBy: 'id',
      id: poolAppId,
    },
    algodClient,
  )
}

const makeStakingPoolClient = (
  poolAppId: number | bigint,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
) => {
  return new StakingPoolClient(
    {
      sender: { signer, addr: activeAddress } as TransactionSignerAccount,
      resolveBy: 'id',
      id: poolAppId,
    },
    algodClient,
  )
}

export function callGetNumValidators(validatorClient: ValidatorRegistryClient) {
  return validatorClient
    .compose()
    .getNumValidators({})
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export function callGetValidatorConfig(
  validatorID: number | bigint,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient
    .compose()
    .getValidatorConfig({ validatorID })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export function callGetValidatorState(
  validatorID: number | bigint,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient
    .compose()
    .getValidatorState({ validatorID })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export async function fetchValidator(
  validatorId: string | number | bigint,
  client?: ValidatorRegistryClient,
) {
  try {
    const activeAddress = getActiveWalletAddress()

    if (!activeAddress) {
      throw new Error('No active wallet found')
    }

    const validatorClient = client || makeSimulateValidatorClient(activeAddress)

    const [config, state] = await Promise.all([
      callGetValidatorConfig(Number(validatorId), validatorClient),
      callGetValidatorState(Number(validatorId), validatorClient),
    ])

    const rawConfig = config.returns![0] as ValidatorConfigRaw
    const rawState = state.returns![0] as ValidatorStateRaw

    if (!rawConfig || !rawState) {
      throw new ValidatorNotFoundError(`Validator with id "${Number(validatorId)}" not found!`)
    }

    // Transform raw data to Validator object
    const validator: Validator = transformValidatorData(rawConfig, rawState)
    return validator
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function fetchValidators(client?: ValidatorRegistryClient) {
  try {
    const activeAddress = getActiveWalletAddress()

    if (!activeAddress) {
      throw new Error('No active wallet found')
    }

    const validatorClient = client || makeSimulateValidatorClient(activeAddress)

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
          return fetchValidator(validatorId, validatorClient)
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

export const validatorsQueryOptions = queryOptions({
  queryKey: ['validators'],
  queryFn: () => fetchValidators(),
})

export const validatorQueryOptions = (validatorId: number | string) =>
  queryOptions({
    queryKey: ['validator', String(validatorId)],
    queryFn: () => fetchValidator(validatorId),
    retry: false,
  })

export class ValidatorNotFoundError extends Error {}

export function callGetNodePoolAssignments(
  validatorID: number | bigint,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient
    .compose()
    .getNodePoolAssignments({ validatorID })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export async function fetchNodePoolAssignments(
  validatorId: string | number | bigint,
): Promise<NodePoolAssignmentConfig> {
  try {
    const activeAddress = getActiveWalletAddress()

    if (!activeAddress) {
      throw new Error('No active wallet found')
    }

    const validatorClient = makeSimulateValidatorClient(activeAddress)

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

export const poolAssignmentQueryOptions = (validatorId: number | string, enabled = true) =>
  queryOptions({
    queryKey: ['pool-assignments', String(validatorId)],
    queryFn: () => fetchNodePoolAssignments(validatorId),
    enabled,
  })

export function callGetMbrAmounts(validatorClient: ValidatorRegistryClient) {
  return validatorClient
    .compose()
    .getMbrAmounts({})
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export async function fetchMbrAmounts(client?: ValidatorRegistryClient): Promise<MbrAmounts> {
  try {
    const activeAddress = getActiveWalletAddress()

    if (!activeAddress) {
      throw new Error('No active wallet found')
    }

    const validatorClient = client || makeSimulateValidatorClient(activeAddress)

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

export const mbrQueryOptions = queryOptions({
  queryKey: ['mbr'],
  queryFn: () => fetchMbrAmounts(),
  staleTime: Infinity,
})

export async function addStakingPool(
  validatorID: number,
  nodeNum: number,
  poolMbr: number,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
): Promise<ValidatorPoolKey> {
  const validatorClient = makeValidatorClient(signer, activeAddress)

  const validatorAppRef = await validatorClient.appClient.getAppReference()
  const suggestedParams = await algodClient.getTransactionParams().do()

  const payValidatorAddPoolMbr = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: activeAddress,
    to: validatorAppRef.appAddress,
    amount: poolMbr,
    suggestedParams,
  })

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
        validatorID,
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
  signer: algosdk.TransactionSigner,
  activeAddress: string,
): Promise<void> {
  const suggestedParams = await algodClient.getTransactionParams().do()

  const payPoolInitStorageMbr = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: activeAddress,
    to: algosdk.getApplicationAddress(poolAppId),
    amount: poolInitMbr,
    suggestedParams,
  })

  const stakingPoolClient = makeStakingPoolClient(poolAppId, signer, activeAddress)

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
  client?: ValidatorRegistryClient,
): Promise<boolean> {
  const validatorClient = client || makeSimulateValidatorClient(activeAddress)

  const result = await validatorClient
    .compose()
    .doesStakerNeedToPayMbr({
      staker: activeAddress,
    })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })

  return result.returns![0]
}

export async function addStake(
  validatorID: number,
  stakeAmount: number, // microalgos
  signer: algosdk.TransactionSigner,
  activeAddress: string,
): Promise<ValidatorPoolKey> {
  // @todo: check whether existing pool(s) have enough room for stakeAmount

  const validatorClient = makeValidatorClient(signer, activeAddress)

  const validatorAppRef = await validatorClient.appClient.getAppReference()
  const suggestedParams = await algodClient.getTransactionParams().do()

  const stakeTransferPayment = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: activeAddress,
    to: validatorAppRef.appAddress,
    amount: stakeAmount,
    suggestedParams,
  })

  let fees = AlgoAmount.MicroAlgos(240_000)

  const simulateResults = await validatorClient
    .compose()
    .gas({})
    .addStake(
      {
        stakedAmountPayment: {
          transaction: stakeTransferPayment,
          signer: { signer, addr: activeAddress } as TransactionSignerAccount,
        },
        validatorID,
        valueToVerify: 0,
      },
      { sendParams: { fee: fees } },
    )
    .simulate({ allowUnnamedResources: true })

  stakeTransferPayment.group = undefined

  // @todo: switch to Joe's new method(s)
  fees = AlgoAmount.MicroAlgos(
    2000 + 1000 * ((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) / 700),
  )

  const results = await validatorClient
    .compose()
    .gas({})
    .addStake(
      {
        stakedAmountPayment: {
          transaction: stakeTransferPayment,
          signer: { signer, addr: activeAddress } as TransactionSignerAccount,
        },
        validatorID,
        valueToVerify: 0,
      },
      { sendParams: { fee: fees } },
    )
    .execute({ populateAppCallResources: true })

  const [valId, poolId, poolAppId] = results.returns![1]

  return {
    poolId: Number(poolId),
    poolAppId: Number(poolAppId),
    validatorId: Number(valId),
  }
}

export async function callFindPoolForStaker(
  validatorID: number | bigint,
  staker: string,
  amountToStake: number | bigint,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient
    .compose()
    .findPoolForStaker({ validatorID, staker, amountToStake })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export async function isNewStakerToValidator(
  validatorID: number | bigint,
  staker: string,
  minStake: number,
) {
  const activeAddress = getActiveWalletAddress()

  if (!activeAddress) {
    throw new Error('No active wallet found')
  }

  const validatorClient = makeSimulateValidatorClient(activeAddress)
  const result = await callFindPoolForStaker(validatorID, staker, minStake, validatorClient)

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
    const activeAddress = getActiveWalletAddress()

    if (!activeAddress) {
      throw new Error('No active wallet found')
    }

    const validatorClient = makeSimulateValidatorClient(activeAddress)
    const result = await callGetStakedPoolsForAccount(staker, validatorClient)

    const stakedPools = result.returns![0]

    return stakedPools.map(([validatorId, poolId, poolAppId]) => ({
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
    const activeAddress = getActiveWalletAddress()

    if (!activeAddress) {
      throw new Error('No active wallet found')
    }

    const stakingPoolClient = makeSimulateStakingPoolClient(poolKey.poolAppId, activeAddress)

    const result = await callGetStakerInfo(staker, stakingPoolClient)

    const [account, balance, totalRewarded, rewardTokenBalance, entryTime] = result.returns![0]

    const stakedInfo: StakedInfo = {
      account,
      balance: Number(balance),
      totalRewarded: Number(totalRewarded),
      rewardTokenBalance: Number(rewardTokenBalance),
      entryTime: Number(entryTime),
    }

    const stakerPoolData: StakerPoolData = {
      ...stakedInfo,
      poolKey,
    }

    return stakerPoolData
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function fetchStakerValidatorData(staker: string): Promise<StakerValidatorData[]> {
  try {
    const activeAddress = getActiveWalletAddress()

    if (!activeAddress) {
      throw new Error('No active wallet found')
    }

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
        // Staker is in another pool for this validator, update validator totals
        existingData.balance += pool.balance
        existingData.totalRewarded += pool.totalRewarded
        existingData.rewardTokenBalance += pool.rewardTokenBalance
        existingData.entryTime = Math.min(existingData.entryTime, pool.entryTime)
        existingData.pools.push(pool) // add pool to existing StakerPoolData[]
      } else {
        // First pool for this validator, add new entry
        acc.push({
          validatorId,
          balance: pool.balance,
          totalRewarded: pool.totalRewarded,
          rewardTokenBalance: pool.rewardTokenBalance,
          entryTime: pool.entryTime,
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
    const activeAddress = getActiveWalletAddress()

    if (!activeAddress) {
      throw new Error('No active wallet found')
    }

    const validatorClient = client || makeSimulateValidatorClient(activeAddress)

    const result = await callGetProtocolConstraints(validatorClient)

    const [
      payoutMinsMin,
      payoutMinsMax,
      commissionPctMin,
      commissionPctMax,
      minEntryStake,
      maxAlgoPerPool,
      maxNodes,
      maxPoolsPerNode,
      maxStakersPerPool,
    ] = result.returns![0] as RawConstraints

    return {
      payoutMinsMin: Number(payoutMinsMin),
      payoutMinsMax: Number(payoutMinsMax),
      commissionPctMin: Number(commissionPctMin),
      commissionPctMax: Number(commissionPctMax),
      minEntryStake: Number(minEntryStake),
      maxAlgoPerPool: Number(maxAlgoPerPool),
      maxNodes: Number(maxNodes),
      maxPoolsPerNode: Number(maxPoolsPerNode),
      maxStakersPerPool: Number(maxStakersPerPool),
    }
  } catch (error) {
    console.error(error)
    throw error
  }
}

export const constraintsQueryOptions = queryOptions({
  queryKey: ['constraints'],
  queryFn: () => fetchProtocolConstraints(),
  staleTime: Infinity,
})

export async function removeStake(
  poolAppId: number | bigint,
  amountToUnstake: number,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
) {
  const stakingPoolSimulateClient = makeSimulateStakingPoolClient(poolAppId, activeAddress)

  const simulateResult = await stakingPoolSimulateClient
    .compose()
    .gas({})
    .removeStake(
      {
        amountToUnstake,
      },
      { sendParams: { fee: AlgoAmount.MicroAlgos(5000) } },
    )
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })

  const stakingPoolClient = makeStakingPoolClient(poolAppId, signer, activeAddress)

  await stakingPoolClient
    .compose()
    .gas(
      {},
      {
        apps: simulateResult.simulateResponse.txnGroups[0].unnamedResourcesAccessed!
          .apps! as number[],
        note: '1',
      },
    )
    .gas({}, { note: '2' })
    .removeStake(
      {
        amountToUnstake,
      },
      { sendParams: { fee: AlgoAmount.MicroAlgos(5000) } },
    )
    .execute({ populateAppCallResources: true })
}

export async function epochBalanceUpdate(
  poolAppId: number | bigint,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
): Promise<void> {
  try {
    let fees = AlgoAmount.MicroAlgos(240_000)
    const stakingPoolSimulateClient = makeSimulateStakingPoolClient(poolAppId, activeAddress)

    const simulateResult = await stakingPoolSimulateClient
      .compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .epochBalanceUpdate({}, { sendParams: { fee: fees } })
      .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })

    // @todo: switch to Joe's new method(s)
    fees = AlgoAmount.MicroAlgos(
      3000 + 1000 * ((simulateResult.simulateResponse.txnGroups[0].appBudgetAdded as number) / 700),
    )

    const stakingPoolClient = makeStakingPoolClient(poolAppId, signer, activeAddress)

    await stakingPoolClient
      .compose()
      .gas({}, { note: '1', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
      .gas({}, { note: '2', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
      .epochBalanceUpdate({}, { sendParams: { fee: fees } })
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
    const activeAddress = getActiveWalletAddress()

    if (!activeAddress) {
      throw new Error('No active wallet found')
    }

    const validatorClient = client || makeSimulateValidatorClient(activeAddress)

    const result = await callGetPoolInfo(poolKey, validatorClient)

    const [poolAppId, totalStakers, totalAlgoStaked] = result.returns![0]

    return {
      poolAppId: Number(poolAppId),
      totalStakers: Number(totalStakers),
      totalAlgoStaked: Number(totalAlgoStaked),
    }
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function callGetPools(
  validatorID: number | bigint,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient
    .compose()
    .getPools({ validatorID })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export async function fetchValidatorPools(
  validatorId: string | number | bigint,
  client?: ValidatorRegistryClient,
): Promise<PoolInfo[]> {
  try {
    const activeAddress = getActiveWalletAddress()

    if (!activeAddress) {
      throw new Error('No active wallet found')
    }

    const validatorClient = client || makeSimulateValidatorClient(activeAddress)

    const result = await callGetPools(Number(validatorId), validatorClient)

    const poolsInfo = result.returns![0]

    return poolsInfo.map(([poolAppId, totalStakers, totalAlgoStaked]) => ({
      poolAppId: Number(poolAppId),
      totalStakers,
      totalAlgoStaked: Number(totalAlgoStaked),
    }))
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function fetchMaxAvailableToStake(
  validatorId: string | number | bigint,
): Promise<number> {
  try {
    const activeAddress = getActiveWalletAddress()

    if (!activeAddress) {
      throw new Error('No active wallet found')
    }

    const validatorClient = makeSimulateValidatorClient(activeAddress)

    const validatorConfigResult = await callGetValidatorConfig(Number(validatorId), validatorClient)
    const rawConfig = validatorConfigResult.returns![0]

    const validatorConfig = transformValidatorConfig(rawConfig)

    const poolsInfo: PoolInfo[] = await fetchValidatorPools(validatorId)

    // For each pool, subtract the totalAlgoStaked from maxAlgoPerPool and return the highest value
    const maxAvailableToStake = poolsInfo.reduce((acc, pool) => {
      const availableToStake = Number(validatorConfig.MaxAlgoPerPool) - pool.totalAlgoStaked
      return availableToStake > acc ? availableToStake : acc
    }, 0)

    return maxAvailableToStake
  } catch (error) {
    console.error(error)
    throw error
  }
}
