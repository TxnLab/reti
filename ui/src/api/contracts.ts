import * as algokit from '@algorandfoundation/algokit-utils'
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import algosdk from 'algosdk'
import { fetchNfd } from '@/api/nfd'
import { ALGORAND_ZERO_ADDRESS_STRING, FEE_SINK } from '@/constants/accounts'
import { StakingPoolClient } from '@/contracts/StakingPoolClient'
import { ValidatorRegistryClient } from '@/contracts/ValidatorRegistryClient'
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
  RawPoolTokenPayoutRatios,
  RawValidatorConfig,
  RawValidatorState,
  Validator,
  ValidatorConfig,
  ValidatorConfigInput,
  ValidatorPoolKey,
} from '@/interfaces/validator'
import { makeEmptyTransactionSigner } from '@/lib/makeEmptyTransactionSigner'
import { chunkBytes } from '@/utils/bytes'
import {
  transformNodePoolAssignment,
  transformStakedInfo,
  transformValidatorData,
} from '@/utils/contracts'
import { getRetiAppIdFromViteEnvironment } from '@/utils/env'
import { getAlgodConfigFromViteEnvironment } from '@/utils/network/getAlgoClientConfigs'

const algodConfig = getAlgodConfigFromViteEnvironment()
const algodClient = algokit.getAlgoClient({
  server: algodConfig.server,
  port: algodConfig.port,
  token: algodConfig.token,
})

const RETI_APP_ID = getRetiAppIdFromViteEnvironment()

export const makeSimulateValidatorClient = (senderAddr: string = FEE_SINK, authAddr?: string) => {
  return new ValidatorRegistryClient(
    {
      sender: { addr: senderAddr, signer: makeEmptyTransactionSigner(authAddr) },
      resolveBy: 'id',
      id: RETI_APP_ID,
    },
    algodClient,
  )
}

export const makeValidatorClient = (signer: algosdk.TransactionSigner, activeAddress: string) => {
  return new ValidatorRegistryClient(
    {
      sender: { signer, addr: activeAddress } as TransactionSignerAccount,
      resolveBy: 'id',
      id: RETI_APP_ID,
    },
    algodClient,
  )
}

export const makeSimulateStakingPoolClient = (
  poolAppId: number | bigint,
  senderAddr: string = FEE_SINK,
  authAddr?: string,
) => {
  return new StakingPoolClient(
    {
      sender: { addr: senderAddr, signer: makeEmptyTransactionSigner(authAddr) },
      resolveBy: 'id',
      id: poolAppId,
    },
    algodClient,
  )
}

export const makeStakingPoolClient = (
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

export async function fetchValidator(
  validatorId: string | number | bigint,
  client?: ValidatorRegistryClient,
) {
  try {
    const validatorClient = client || makeSimulateValidatorClient()

    const [config, state, validatorPoolData, poolTokenPayoutRatios, nodePoolAssignments] =
      await Promise.all([
        callGetValidatorConfig(Number(validatorId), validatorClient),
        callGetValidatorState(Number(validatorId), validatorClient),
        callGetPools(Number(validatorId), validatorClient),
        callGetTokenPayoutRatio(Number(validatorId), validatorClient),
        callGetNodePoolAssignments(Number(validatorId), validatorClient),
      ])

    const rawConfig = config.returns?.[0] as RawValidatorConfig
    const rawState = state.returns?.[0] as RawValidatorState
    const rawPoolsInfo = validatorPoolData.returns?.[0] as RawPoolsInfo
    const rawPoolTokenPayoutRatios = poolTokenPayoutRatios.returns?.[0] as RawPoolTokenPayoutRatios
    const rawNodePoolAssignment = nodePoolAssignments.returns?.[0] as RawNodePoolAssignmentConfig

    if (
      !rawConfig ||
      !rawState ||
      !rawPoolsInfo ||
      !rawPoolTokenPayoutRatios ||
      !rawNodePoolAssignment
    ) {
      throw new ValidatorNotFoundError(`Validator with id "${Number(validatorId)}" not found!`)
    }

    // Transform raw data to Validator object
    const validator: Validator = transformValidatorData(
      rawConfig,
      rawState,
      rawPoolsInfo,
      rawPoolTokenPayoutRatios,
      rawNodePoolAssignment,
    )

    if (validator.config.nfdForInfo > 0) {
      const nfd = await fetchNfd(validator.config.nfdForInfo, { view: 'full' })
      validator.nfd = nfd
    }

    return validator
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function fetchValidators(client?: ValidatorRegistryClient) {
  try {
    const validatorClient = client || makeSimulateValidatorClient()

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

export class ValidatorNotFoundError extends Error {}

export async function addValidator(
  values: ValidatorConfigInput,
  nfdAppId: number,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
  authAddr?: string,
) {
  const validatorClient = makeValidatorClient(signer, activeAddress)

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

  const suggestedParams = await algodClient.getTransactionParams().do()

  const payValidatorMbr = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: activeAddress,
    to: validatorAppRef.appAddress,
    amount: Number(validatorMbr),
    suggestedParams,
  })

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
    payoutEveryXMins: Number(values.payoutEveryXMins),
    percentToValidator: Number(values.percentToValidator) * 10000,
    validatorCommissionAddress: values.validatorCommissionAddress,
    minEntryStake: BigInt(AlgoAmount.Algos(Number(values.minEntryStake)).microAlgos),
    maxAlgoPerPool: BigInt(0),
    poolsPerNode: Number(values.poolsPerNode),
    sunsettingOn: Number(0),
    sunsettingTo: Number(0),
  }

  const simulateValidatorClient = makeSimulateValidatorClient(activeAddress, authAddr)

  const simulateResult = await simulateValidatorClient
    .compose()
    .addValidator(
      {
        mbrPayment: {
          transaction: payValidatorMbr,
          signer: { addr: activeAddress, signer: makeEmptyTransactionSigner(authAddr) },
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
          validatorConfig.payoutEveryXMins,
          validatorConfig.percentToValidator,
          validatorConfig.validatorCommissionAddress,
          validatorConfig.minEntryStake,
          validatorConfig.maxAlgoPerPool,
          validatorConfig.poolsPerNode,
          validatorConfig.sunsettingOn,
          validatorConfig.sunsettingTo,
        ],
      },
      { sendParams: { fee: AlgoAmount.MicroAlgos(240_000) } },
    )
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })

  payValidatorMbr.group = undefined

  // @todo: switch to Joe's new method(s)
  const feesAmount = AlgoAmount.MicroAlgos(
    1000 *
      Math.floor(
        ((simulateResult.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700,
      ),
  )

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
          validatorConfig.payoutEveryXMins,
          validatorConfig.percentToValidator,
          validatorConfig.validatorCommissionAddress,
          validatorConfig.minEntryStake,
          validatorConfig.maxAlgoPerPool,
          validatorConfig.poolsPerNode,
          validatorConfig.sunsettingOn,
          validatorConfig.sunsettingTo,
        ],
      },
      { sendParams: { fee: feesAmount } },
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
    const validatorClient = makeSimulateValidatorClient()

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

export function callGetTokenPayoutRatio(
  validatorId: number | bigint,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient
    .compose()
    .getTokenPayoutRatio({ validatorId })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export async function fetchTokenPayoutRatio(validatorId: string | number | bigint) {
  try {
    const validatorClient = makeSimulateValidatorClient()

    const result = await callGetTokenPayoutRatio(Number(validatorId), validatorClient)

    return result.returns![0]
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
    const validatorClient = client || makeSimulateValidatorClient()

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
  const suggestedParams = await algodClient.getTransactionParams().do()

  const mbrAmount = optInRewardToken ? poolInitMbr + AlgoAmount.Algos(0.1).microAlgos : poolInitMbr

  const payPoolInitStorageMbr = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: activeAddress,
    to: algosdk.getApplicationAddress(poolAppId),
    amount: mbrAmount,
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
  authAddr?: string,
  client?: ValidatorRegistryClient,
): Promise<boolean> {
  const validatorClient = client || makeSimulateValidatorClient(activeAddress, authAddr)

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
  const validatorClient = client || makeSimulateValidatorClient(activeAddress, authAddr)

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
  signer: algosdk.TransactionSigner,
  activeAddress: string,
  authAddr?: string,
): Promise<ValidatorPoolKey> {
  const validatorClient = makeValidatorClient(signer, activeAddress)

  const validatorAppRef = await validatorClient.appClient.getAppReference()
  const suggestedParams = await algodClient.getTransactionParams().do()

  const stakeTransferPayment = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: activeAddress,
    to: validatorAppRef.appAddress,
    amount: stakeAmount,
    suggestedParams,
  })

  const simulateValidatorClient = makeSimulateValidatorClient(activeAddress, authAddr)

  const simulateResults = await simulateValidatorClient
    .compose()
    .gas({})
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
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })

  stakeTransferPayment.group = undefined

  // @todo: switch to Joe's new method(s)
  const feesAmount = AlgoAmount.MicroAlgos(
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
        validatorId,
        valueToVerify,
      },
      { sendParams: { fee: feesAmount } },
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
  const validatorClient = makeSimulateValidatorClient()
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
    const validatorClient = makeSimulateValidatorClient()
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
    const stakingPoolClient = makeSimulateStakingPoolClient(poolKey.poolAppId)
    const stakingPoolGS = await stakingPoolClient.appClient.getGlobalState()
    let lastPayoutTime: Date = new Date()
    if (stakingPoolGS.lastPayout !== undefined) {
      lastPayoutTime = new Date(Number(stakingPoolGS.lastPayout.value as bigint) * 1000)
    }

    const result = await callGetStakerInfo(staker, stakingPoolClient)

    const [account, balance, totalRewarded, rewardTokenBalance, entryTime] = result.returns![0]

    const stakedInfo: StakedInfo = {
      account,
      balance,
      totalRewarded,
      rewardTokenBalance,
      entryTime: Number(entryTime),
    }

    return {
      ...stakedInfo,
      poolKey,
      lastPayout: lastPayoutTime.getTime() / 1000,
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
        existingData.entryTime = Math.min(existingData.entryTime, pool.entryTime)
        existingData.lastPayout = Math.min(existingData.lastPayout, pool.lastPayout)
        existingData.pools.push(pool) // add pool to existing StakerPoolData[]
      } else {
        // First pool for this validator, add new entry
        acc.push({
          validatorId,
          balance: pool.balance,
          totalRewarded: pool.totalRewarded,
          rewardTokenBalance: pool.rewardTokenBalance,
          entryTime: pool.entryTime,
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
    const validatorClient = client || makeSimulateValidatorClient()

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
      payoutMinsMin: Number(payoutMinsMin),
      payoutMinsMax: Number(payoutMinsMax),
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
  signer: algosdk.TransactionSigner,
  activeAddress: string,
  authAddr?: string,
) {
  const stakingPoolSimulateClient = makeSimulateStakingPoolClient(
    poolAppId,
    activeAddress,
    authAddr,
  )

  const simulateResult = await stakingPoolSimulateClient
    .compose()
    .gas({}, { note: '1', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
    .gas({}, { note: '2', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
    .removeStake(
      {
        amountToUnstake,
      },
      { sendParams: { fee: AlgoAmount.MicroAlgos(240_000) } },
    )
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })

  // @todo: switch to Joe's new method(s)
  const feesAmount = AlgoAmount.MicroAlgos(
    1000 *
      Math.floor(
        ((simulateResult.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700,
      ),
  )

  const stakingPoolClient = makeStakingPoolClient(poolAppId, signer, activeAddress)

  await stakingPoolClient
    .compose()
    .gas({}, { note: '1', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
    .gas({}, { note: '2', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
    .removeStake(
      {
        amountToUnstake,
      },
      { sendParams: { fee: feesAmount } },
    )
    .execute({ populateAppCallResources: true })
}

export async function epochBalanceUpdate(
  poolAppId: number | bigint,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
  authAddr?: string,
): Promise<void> {
  try {
    const stakingPoolSimulateClient = makeSimulateStakingPoolClient(
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
    const feesAmount = AlgoAmount.MicroAlgos(
      3000 + 1000 * ((simulateResult.simulateResponse.txnGroups[0].appBudgetAdded as number) / 700),
    )

    const stakingPoolClient = makeStakingPoolClient(poolAppId, signer, activeAddress)

    await stakingPoolClient
      .compose()
      .gas({}, { note: '1', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
      .gas({}, { note: '2', sendParams: { fee: AlgoAmount.MicroAlgos(0) } })
      .epochBalanceUpdate({}, { sendParams: { fee: feesAmount } })
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
    const validatorClient = client || makeSimulateValidatorClient()

    const result = await callGetPoolInfo(poolKey, validatorClient)

    const [poolAppId, totalStakers, totalAlgoStaked] = result.returns![0]

    const stakingPoolClient = makeSimulateStakingPoolClient(poolAppId)
    const poolAppRef = await stakingPoolClient.appClient.getAppReference()
    const poolAddress = poolAppRef.appAddress

    return {
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
    .getPools({ validatorId })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export async function fetchValidatorPools(
  validatorId: string | number,
  client?: ValidatorRegistryClient,
): Promise<PoolInfo[]> {
  try {
    const validatorClient = client || makeSimulateValidatorClient()

    const result = await callGetPools(Number(validatorId), validatorClient)

    const poolsInfo = result.returns![0]

    const poolAddresses: string[] = []

    for (const poolInfo of poolsInfo) {
      const stakingPoolClient = makeSimulateStakingPoolClient(poolInfo[0])
      const poolAppRef = await stakingPoolClient.appClient.getAppReference()
      const poolAddress = poolAppRef.appAddress
      poolAddresses.push(poolAddress)
    }

    return poolsInfo.map(([poolAppId, totalStakers, totalAlgoStaked], i) => ({
      poolAppId: Number(poolAppId),
      totalStakers: Number(totalStakers),
      totalAlgoStaked,
      poolAddress: poolAddresses[i],
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
    const client = makeSimulateStakingPoolClient(pool.poolAppId, activeAddress, authAddr)
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
  const feesAmount = AlgoAmount.MicroAlgos(
    1000 *
      Math.floor(
        ((simulateResult.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700,
      ),
  )

  const atc2 = new algosdk.AtomicTransactionComposer()

  for (const pool of pools) {
    const client = makeStakingPoolClient(pool.poolAppId, signer, activeAddress)
    await client.gas({}, { note: '1', sendParams: { atc: atc2, fee: AlgoAmount.MicroAlgos(0) } })
    await client.gas({}, { note: '2', sendParams: { atc: atc2, fee: AlgoAmount.MicroAlgos(0) } })
    await client.claimTokens({}, { sendParams: { atc: atc2, fee: feesAmount } })
  }

  await algokit.sendAtomicTransactionComposer(
    { atc: atc2, sendParams: { populateAppCallResources: true } },
    algodClient,
  )
}

export async function fetchStakedInfoForPool(poolAppId: number): Promise<StakedInfo[]> {
  try {
    const stakingPoolClient = makeSimulateStakingPoolClient(poolAppId)
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
