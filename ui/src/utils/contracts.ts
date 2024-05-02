import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { QueryClient } from '@tanstack/react-query'
import algosdk from 'algosdk'
import { getAccountInformation } from '@/api/algod'
import { fetchNfd, fetchNfdSearch } from '@/api/nfd'
import {
  GATING_TYPE_ASSETS_CREATED_BY,
  GATING_TYPE_ASSET_ID,
  GATING_TYPE_CREATED_BY_NFD_ADDRESSES,
  GATING_TYPE_NONE,
  GATING_TYPE_SEGMENT_OF_NFD,
} from '@/constants/gating'
import { AssetHolding } from '@/interfaces/algod'
import { NfdSearchV2Params } from '@/interfaces/nfd'
import { StakedInfo, StakerValidatorData } from '@/interfaces/staking'
import {
  Constraints,
  NodeInfo,
  NodePoolAssignmentConfig,
  PoolTokenPayoutRatio,
  RawPoolTokenPayoutRatios,
  RawNodePoolAssignmentConfig,
  Validator,
  ValidatorConfig,
  RawValidatorConfig,
  ValidatorState,
  RawValidatorState,
  PoolInfo,
  RawPoolsInfo,
  EntryGatingAssets,
} from '@/interfaces/validator'
import { dayjs } from '@/utils/dayjs'

export function transformValidatorConfig(rawConfig: RawValidatorConfig): ValidatorConfig {
  return {
    id: Number(rawConfig[0]),
    owner: rawConfig[1],
    manager: rawConfig[2],
    nfdForInfo: Number(rawConfig[3]),
    entryGatingType: Number(rawConfig[4]),
    entryGatingAddress: rawConfig[5],
    entryGatingAssets: rawConfig[6].map((asset) => Number(asset)) as EntryGatingAssets,
    gatingAssetMinBalance: rawConfig[7],
    rewardTokenId: Number(rawConfig[8]),
    rewardPerPayout: rawConfig[9],
    payoutEveryXMins: Number(rawConfig[10]),
    percentToValidator: Number(rawConfig[11]),
    validatorCommissionAddress: rawConfig[12],
    minEntryStake: rawConfig[13],
    maxAlgoPerPool: rawConfig[14],
    poolsPerNode: Number(rawConfig[15]),
    sunsettingOn: Number(rawConfig[16]),
    sunsettingTo: Number(rawConfig[17]),
  }
}

export function transformValidatorState(rawState: RawValidatorState): ValidatorState {
  return {
    numPools: Number(rawState[0]),
    totalStakers: Number(rawState[1]),
    totalAlgoStaked: rawState[2],
    rewardTokenHeldBack: rawState[3],
  }
}

export function transformPoolsInfo(rawPoolsInfo: RawPoolsInfo): PoolInfo[] {
  return rawPoolsInfo.map((poolInfo) => ({
    poolAppId: Number(poolInfo[0]),
    totalStakers: Number(poolInfo[1]),
    totalAlgoStaked: poolInfo[2],
  }))
}

export function transformNodePoolAssignment(
  rawConfig: RawNodePoolAssignmentConfig,
): NodePoolAssignmentConfig {
  return rawConfig[0].flat()
}

export function transformPoolTokenPayoutRatio(rawData: RawPoolTokenPayoutRatios): number[] {
  const [poolPctOfWhole, updatedForPayout] = rawData

  const poolTokenPayoutRatio: PoolTokenPayoutRatio = {
    poolPctOfWhole: poolPctOfWhole.map((poolPct) => Number(poolPct)),
    updatedForPayout: Number(updatedForPayout),
  }

  return poolTokenPayoutRatio.poolPctOfWhole
}

export function transformValidatorData(
  rawConfig: RawValidatorConfig,
  rawState: RawValidatorState,
  rawPoolsInfo: RawPoolsInfo,
  rawPoolTokenPayoutRatios: RawPoolTokenPayoutRatios,
  rawNodePoolAssignment: RawNodePoolAssignmentConfig,
): Validator {
  const { id, ...config } = transformValidatorConfig(rawConfig)
  const state = transformValidatorState(rawState)
  const pools = transformPoolsInfo(rawPoolsInfo)
  const tokenPayoutRatio = transformPoolTokenPayoutRatio(rawPoolTokenPayoutRatios)
  const nodePoolAssignment = transformNodePoolAssignment(rawNodePoolAssignment)

  return {
    id,
    config,
    state,
    pools,
    tokenPayoutRatio,
    nodePoolAssignment,
  }
}

export function transformStakedInfo(data: Uint8Array): StakedInfo {
  return {
    account: algosdk.encodeAddress(data.slice(0, 32)),
    balance: algosdk.bytesToBigInt(data.slice(32, 40)),
    totalRewarded: algosdk.bytesToBigInt(data.slice(40, 48)),
    rewardTokenBalance: algosdk.bytesToBigInt(data.slice(48, 56)),
    entryTime: Number(algosdk.bytesToBigInt(data.slice(56, 64))),
  }
}

export function processNodePoolAssignment(
  nodes: NodePoolAssignmentConfig,
  poolsPerNode: number,
): NodeInfo[] {
  return nodes.map((nodeConfig, index) => {
    const availableSlots = nodeConfig.filter(
      (slot, i) => i < poolsPerNode && slot === BigInt(0),
    ).length

    return {
      index: index + 1,
      availableSlots,
    }
  })
}

export function validatorHasAvailableSlots(
  nodePoolAssignmentConfig: NodePoolAssignmentConfig,
  poolsPerNode: number,
): boolean {
  return nodePoolAssignmentConfig.some((nodeConfig) => {
    const slotIndex = nodeConfig.indexOf(BigInt(0))
    return slotIndex !== -1 && slotIndex < poolsPerNode
  })
}

export function findFirstAvailableNode(
  nodePoolAssignmentConfig: NodePoolAssignmentConfig,
  poolsPerNode: number,
): number | null {
  for (let nodeIndex = 0; nodeIndex < nodePoolAssignmentConfig.length; nodeIndex++) {
    const slotIndex = nodePoolAssignmentConfig[nodeIndex].indexOf(BigInt(0))
    if (slotIndex !== -1 && slotIndex < poolsPerNode) {
      return nodeIndex + 1
    }
  }
  return null // No available slot found
}

export function getEpochLengthMinutes(value: string, epochTimeframe: string): number {
  switch (epochTimeframe) {
    case 'minutes':
      return Number(value)
    case 'hours':
      return Number(value) * 60
    case 'days':
      return Number(value) * 60 * 24
    default:
      return 0
  }
}

export function transformEntryGatingAssets(
  type: string,
  assets: Array<{ value: string }>,
  nfdCreatorAppId: number,
  nfdParentAppId: number,
): string[] {
  const fixedLengthArray: string[] = new Array(4).fill('0')

  switch (type) {
    case String(GATING_TYPE_ASSET_ID):
      for (let i = 0; i < assets.length && i < 4; i++) {
        fixedLengthArray[i] = assets[i].value !== '' ? assets[i].value : '0'
      }
      return fixedLengthArray.sort((a, b) => Number(b) - Number(a))
    case String(GATING_TYPE_CREATED_BY_NFD_ADDRESSES):
      return [nfdCreatorAppId.toString(), '0', '0', '0']
    case String(GATING_TYPE_SEGMENT_OF_NFD):
      return [nfdParentAppId.toString(), '0', '0', '0']
    default:
      return fixedLengthArray
  }
}

export function calculateMaxStake(
  validator: Validator,
  constraints?: Constraints,
  algos = false,
): number {
  const { numPools } = validator.state
  if (numPools === 0 || !constraints) {
    return 0
  }
  const hardMaxDividedBetweenPools = constraints.maxAlgoPerValidator / BigInt(numPools)
  let { maxAlgoPerPool } = validator.config
  if (maxAlgoPerPool === 0n) {
    maxAlgoPerPool = constraints.maxAlgoPerPool
  }
  if (hardMaxDividedBetweenPools < maxAlgoPerPool) {
    maxAlgoPerPool = hardMaxDividedBetweenPools
  }

  const maxStake = Number(maxAlgoPerPool) * numPools

  if (algos) {
    return AlgoAmount.MicroAlgos(maxStake).algos
  }

  return maxStake
}

export function calculateMaxStakers(validator: Validator, constraints?: Constraints): number {
  const maxStakersPerPool = constraints?.maxStakersPerPool || 0
  const maxStakers = maxStakersPerPool * validator.state.numPools

  return maxStakers
}

export function isStakingDisabled(
  activeAddress: string | null,
  validator: Validator,
  constraints?: Constraints,
): boolean {
  if (!activeAddress) {
    return true
  }
  const { numPools, totalStakers, totalAlgoStaked } = validator.state

  let { maxAlgoPerPool } = validator.config

  if (maxAlgoPerPool === 0n && !!constraints) {
    maxAlgoPerPool = constraints.maxAlgoPerPool
  }

  const maxStakersPerPool = constraints?.maxStakersPerPool || 0

  const maxStakers = maxStakersPerPool * numPools
  const maxStake = Number(maxAlgoPerPool) * numPools

  const noPools = numPools === 0
  const maxStakersReached = totalStakers >= maxStakers
  const maxStakeReached = Number(totalAlgoStaked) >= maxStake

  return noPools || maxStakersReached || maxStakeReached
}

export function isUnstakingDisabled(
  activeAddress: string | null,
  validator: Validator,
  stakesByValidator: StakerValidatorData[],
): boolean {
  if (!activeAddress) {
    return true
  }
  const noPools = validator.state.numPools === 0
  const validatorHasStake = stakesByValidator.some((stake) => stake.validatorId === validator.id)

  return noPools || !validatorHasStake
}

export function isAddingPoolDisabled(
  activeAddress: string | null,
  validator: Validator,
  constraints?: Constraints,
): boolean {
  if (!activeAddress || !constraints) {
    return true
  }
  const maxNodes = constraints.maxNodes
  const { numPools } = validator.state
  const { poolsPerNode } = validator.config

  const hasAvailableSlots = numPools < poolsPerNode * maxNodes

  return !hasAvailableSlots
}

export function canManageValidator(activeAddress: string | null, validator: Validator): boolean {
  if (!activeAddress) {
    return false
  }
  const { owner, manager } = validator.config
  return owner === activeAddress || manager === activeAddress
}

export async function fetchGatingAssets(
  validator: Validator | null,
  activeAddress: string | null,
): Promise<number[]> {
  if (!validator || !activeAddress) {
    return []
  }

  const { entryGatingType, entryGatingAddress, entryGatingAssets } = validator.config

  if (entryGatingType === GATING_TYPE_ASSETS_CREATED_BY) {
    const creatorAddress = entryGatingAddress
    const accountInfo = await getAccountInformation(creatorAddress)

    if (accountInfo['created-assets']) {
      const assetIds = accountInfo['created-assets'].map((asset) => asset.index)
      return assetIds
    }
  }

  if (entryGatingType === GATING_TYPE_ASSET_ID) {
    return entryGatingAssets.filter((asset) => asset !== 0)
  }

  if (entryGatingType === GATING_TYPE_CREATED_BY_NFD_ADDRESSES) {
    const nfdAppId = entryGatingAssets[0]
    const nfd = await fetchNfd(nfdAppId, { view: 'tiny' })
    const addresses = nfd.caAlgo || []

    const promises = addresses.map((address) => getAccountInformation(address))
    const accountsInfo = await Promise.all(promises)
    const assetIds = accountsInfo
      .map((accountInfo) => accountInfo['created-assets'])
      .flat()
      .filter((asset) => !!asset)
      .map((asset) => asset!.index)

    return assetIds
  }

  if (entryGatingType === GATING_TYPE_SEGMENT_OF_NFD) {
    const parentAppID = entryGatingAssets[0]

    let offset = 0
    const limit = 20
    let hasMoreRecords = true

    const assetIds: number[] = []

    while (hasMoreRecords) {
      const params: NfdSearchV2Params = {
        parentAppID,
        owner: activeAddress,
        view: 'brief',
        limit: limit,
        offset: offset,
      }

      try {
        const result = await fetchNfdSearch(params)

        const ids = result.nfds.map((nfd) => nfd.asaID!)
        assetIds.push(...ids)

        if (result.nfds.length < limit) {
          hasMoreRecords = false
        } else {
          offset += limit
        }
      } catch (error) {
        console.error('Error fetching data:', error)
        throw error
      }
    }

    return assetIds
  }

  return []
}

export function hasQualifiedGatingAsset(
  heldAssets: AssetHolding[],
  gatingAssets: number[],
  minBalance: number,
): boolean {
  if (gatingAssets.length == 0) {
    return true
  }

  return heldAssets.some(
    (asset) => gatingAssets.includes(asset['asset-id']) && asset.amount >= minBalance,
  )
}

export function findQualifiedGatingAssetId(
  heldAssets: AssetHolding[],
  gatingAssets: number[],
  minBalance: number,
): number {
  const asset = heldAssets.find(
    (asset) => gatingAssets.includes(asset['asset-id']) && asset.amount >= minBalance,
  )
  return asset?.['asset-id'] || 0
}

export function calculateMaxAvailableToStake(validator: Validator, constraints?: Constraints) {
  let { maxAlgoPerPool } = validator.config

  if (maxAlgoPerPool === 0n) {
    if (!constraints) {
      return 0
    }
    maxAlgoPerPool = constraints.maxAlgoPerPool
  }

  // For each pool, subtract the totalAlgoStaked from maxAlgoPerPool and return the highest value
  const maxAvailableToStake = validator.pools.reduce((acc, pool) => {
    const availableToStake = Number(maxAlgoPerPool) - Number(pool.totalAlgoStaked)
    return availableToStake > acc ? availableToStake : acc
  }, 0)

  return maxAvailableToStake
}

/**
 * Calculate rewards eligibility percentage for a staker based on their entry time and last pool payout time
 *
 * @param {number} epochLengthMins Validator payout frequency in minutes (payoutEveryXMins)
 * @param {number} lastPoolPayoutTime Last pool payout time in Unix timestamp
 * @param {number} entryTime Staker entry time in Unix timestamp (15 min postdated)
 * @returns {number | null} Rewards eligibility percentage, or null if any input parameters are zero/undefined
 */
export function calculateRewardEligibility(
  epochLengthMins = 0,
  lastPoolPayoutTime = 0,
  entryTime = 0,
): number | null {
  if (epochLengthMins == 0 || entryTime == 0 || lastPoolPayoutTime == 0) {
    return null
  }

  const now = dayjs()
  const entry = dayjs.unix(entryTime)
  const lastPayout = dayjs.unix(lastPoolPayoutTime)

  // Calculate the next payout time
  let nextPayout = lastPayout.add(epochLengthMins, 'minutes')

  // If the next payout time is in the past (i.e., no rewards last payout), set next payout to now
  if (nextPayout.isBefore(now)) {
    nextPayout = now
  }

  // Calculate rewards eligibility as a percentage of time elapsed since entry
  const epochLengthSecs = dayjs.duration({ minutes: epochLengthMins }).asSeconds()
  const elapsedTimeSecs = nextPayout.diff(entry, 'seconds')
  let eligibilityPercent = (elapsedTimeSecs / epochLengthSecs) * 100

  // Ensure eligibility falls within 0-100% range
  // If eligibility is negative, it means they're past the epoch (entry time + 320 rounds, ~16 mins)
  eligibilityPercent = Math.max(0, Math.min(eligibilityPercent, 100))

  // Round down to nearest integer
  return Math.floor(eligibilityPercent)
}

/**
 * Update validator data in the query cache after a mutation
 * @param {QueryClient} queryClient - Tanstack Query client instance
 * @param {Validator} data - The new validator object
 */
export function setValidatorQueriesData(queryClient: QueryClient, data: Validator): void {
  const { id, nodePoolAssignment, pools } = data

  queryClient.setQueryData<Validator[]>(['validators'], (prevData) => {
    if (!prevData) {
      return prevData
    }

    const validatorExists = prevData.some((validator) => validator.id === id)

    if (validatorExists) {
      return prevData.map((validator) => (validator.id === id ? data : validator))
    } else {
      return [...prevData, data]
    }
  })

  queryClient.setQueryData<Validator>(['validator', String(id)], data)
  queryClient.setQueryData<PoolInfo[]>(['pools-info', String(id)], pools)
  queryClient.setQueryData<NodePoolAssignmentConfig>(
    ['pool-assignments', String(id)],
    nodePoolAssignment,
  )
}
