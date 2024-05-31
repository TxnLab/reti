import { QueryClient } from '@tanstack/react-query'
import algosdk from 'algosdk'
import { fetchAccountAssetInformation, fetchAccountInformation } from '@/api/algod'
import { fetchNfd, fetchNfdSearch } from '@/api/nfd'
import { GatingType } from '@/constants/gating'
import { Asset, AssetHolding } from '@/interfaces/algod'
import { NfdSearchV2Params } from '@/interfaces/nfd'
import { StakedInfo, StakerValidatorData } from '@/interfaces/staking'
import {
  Constraints,
  EntryGatingAssets,
  NodeInfo,
  NodePoolAssignmentConfig,
  PoolInfo,
  RawNodePoolAssignmentConfig,
  RawPoolsInfo,
  RawValidatorConfig,
  RawValidatorState,
  Validator,
  ValidatorConfig,
  ValidatorState,
} from '@/interfaces/validator'
import { dayjs } from '@/utils/dayjs'
import { convertToBaseUnits } from '@/utils/format'

/**
 * Transform raw validator configuration data (from `callGetValidatorConfig`) into a structured object
 * @param {RawValidatorConfig} rawConfig - Raw validator configuration data
 * @returns {ValidatorConfig} Structured validator configuration object
 */
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
    epochRoundLength: Number(rawConfig[10]),
    percentToValidator: Number(rawConfig[11]),
    validatorCommissionAddress: rawConfig[12],
    minEntryStake: rawConfig[13],
    maxAlgoPerPool: rawConfig[14],
    poolsPerNode: Number(rawConfig[15]),
    sunsettingOn: Number(rawConfig[16]),
    sunsettingTo: Number(rawConfig[17]),
  }
}

/**
 * Transform raw validator state data (from `callGetValidatorState`) into a structured object
 * @param {RawValidatorState} rawState - Raw validator state data
 * @returns {ValidatorState} Structured validator state object
 */
export function transformValidatorState(rawState: RawValidatorState): ValidatorState {
  return {
    numPools: Number(rawState[0]),
    totalStakers: Number(rawState[1]),
    totalAlgoStaked: rawState[2],
    rewardTokenHeldBack: rawState[3],
  }
}

/**
 * Transform raw staking pool data (from `callGetPools`) into structured objects
 * @param {RawPoolsInfo} rawPoolsInfo - Raw staking pool data
 * @returns {PoolInfo[]} Structured pool info objects
 */
export function transformPoolsInfo(rawPoolsInfo: RawPoolsInfo): PoolInfo[] {
  return rawPoolsInfo.map((poolInfo, i) => ({
    poolId: i + 1,
    poolAppId: Number(poolInfo[0]),
    totalStakers: Number(poolInfo[1]),
    totalAlgoStaked: poolInfo[2],
  }))
}

/**
 * Transform raw node pool assignment configuration data (from `callGetNodePoolAssignments`) into a flat array
 * @param {RawNodePoolAssignmentConfig} rawConfig - Raw node pool assignment configuration data
 * @returns {NodePoolAssignmentConfig} Flattened array of `NodeConfig` objects
 */
export function transformNodePoolAssignment(
  rawConfig: RawNodePoolAssignmentConfig,
): NodePoolAssignmentConfig {
  return rawConfig[0].flat()
}

/**
 * Transform raw validator data from multiple ABI method calls into a structured `Validator` object
 * @param {RawValidatorConfig} rawConfig - Raw validator configuration data
 * @param {RawValidatorState} rawState - Raw validator state data
 * @param {RawPoolsInfo} rawPoolsInfo - Raw staking pool data
 * @param {RawNodePoolAssignmentConfig} rawNodePoolAssignment - Raw node pool assignment configuration data
 * @returns {Validator} Structured validator object
 */
export function transformValidatorData(
  rawConfig: RawValidatorConfig,
  rawState: RawValidatorState,
  rawPoolsInfo: RawPoolsInfo,
  rawNodePoolAssignment: RawNodePoolAssignmentConfig,
): Validator {
  const { id, ...config } = transformValidatorConfig(rawConfig)
  const state = transformValidatorState(rawState)
  const pools = transformPoolsInfo(rawPoolsInfo)
  const nodePoolAssignment = transformNodePoolAssignment(rawNodePoolAssignment)

  return {
    id,
    config,
    state,
    pools,
    nodePoolAssignment,
  }
}

/**
 * Transform raw staked info byte data from box storage into a structured `StakedInfo` object
 * @param {Uint8Array} data - Raw staked info data (in a 64-byte chunk)
 * @returns {StakedInfo} Structured staked info object
 */
export function transformStakedInfo(data: Uint8Array): StakedInfo {
  return {
    account: algosdk.encodeAddress(data.slice(0, 32)),
    balance: algosdk.bytesToBigInt(data.slice(32, 40)),
    totalRewarded: algosdk.bytesToBigInt(data.slice(40, 48)),
    rewardTokenBalance: algosdk.bytesToBigInt(data.slice(48, 56)),
    entryRound: Number(algosdk.bytesToBigInt(data.slice(56, 64))),
  }
}

/**
 * Process node pool assignment configuration data into an array with each node's available slot count
 * @param {NodePoolAssignmentConfig} nodes - Node pool assignment configuration data
 * @param {number} poolsPerNode - Number of pools per node
 * @returns {NodeInfo[]} Array of objects containing node `index` and `availableSlots`
 */
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

/**
 * Check if a validator has available slots for more pools
 * @param {NodePoolAssignmentConfig} nodePoolAssignmentConfig - Ordered array of single `NodeConfig` arrays per pool
 * @param {number} poolsPerNode - Number of pools per node
 * @returns {boolean} Whether the validator has available slots
 */
export function validatorHasAvailableSlots(
  nodePoolAssignmentConfig: NodePoolAssignmentConfig,
  poolsPerNode: number,
): boolean {
  return nodePoolAssignmentConfig.some((nodeConfig) => {
    const slotIndex = nodeConfig.indexOf(BigInt(0))
    return slotIndex !== -1 && slotIndex < poolsPerNode
  })
}

/**
 * Find the first available node with a slot for a new pool
 * @param {NodePoolAssignmentConfig} nodePoolAssignmentConfig - Node pool assignment configuration data
 * @param {number} poolsPerNode - Number of pools per node
 * @returns {number | null} Node index with available slot, or null if no available slots found
 */
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

/**
 * Returns the number of blocks in a given timeframe based on the average block time
 * @param {string} value - User provided value for epoch length
 * @param {string} epochTimeframe - Selected epoch timeframe unit ('blocks', 'minutes', 'hours', 'days')
 * @param {number} averageBlockTime - Average block time in milliseconds
 * @returns {number} Number of blocks in the given timeframe
 */
export function getEpochLengthBlocks(
  value: string,
  epochTimeframe: string,
  averageBlockTime: number = 0,
): number {
  if (epochTimeframe !== 'blocks' && averageBlockTime <= 0) {
    throw new Error('Average block time must be greater than zero.')
  }

  const numericValue = Number(value)
  if (isNaN(numericValue)) {
    throw new Error('Value must be a number.')
  }

  switch (epochTimeframe) {
    case 'blocks':
      return numericValue // If 'blocks', return numericValue as-is
    case 'minutes':
      return Math.floor((numericValue * 60 * 1000) / averageBlockTime)
    case 'hours':
      return Math.floor((numericValue * 60 * 60 * 1000) / averageBlockTime)
    case 'days':
      return Math.floor((numericValue * 24 * 60 * 60 * 1000) / averageBlockTime)
    default:
      return 0
  }
}

interface TransformedGatingAssets {
  entryGatingAssets: string[]
  gatingAssetMinBalance: string
}

/**
 * Prepares entry gating assets and minimum balance to submit to the contract
 * @param {string} type - Entry gating type
 * @param {Array<{ value: string }>} assetIds - Entry gating asset IDs from form input
 * @param {Array<Asset | null>} assets - Array of fetched asset objects
 * @param {string} minBalance - Minimum balance required for gating assets
 * @param {number} nfdCreatorAppId - NFD creator app ID
 * @param {number} nfdParentAppId - NFD parent app ID
 * @returns {TransformedGatingAssets} Gating assets and minimum balance prepared for submission
 */
export function transformEntryGatingAssets(
  type: string,
  assetIds: Array<{ value: string }>,
  assets: Array<Asset | null>,
  minBalance: string,
  nfdCreatorAppId: number,
  nfdParentAppId: number,
): TransformedGatingAssets {
  const fixedLengthArray: string[] = new Array(4).fill('0')

  switch (type) {
    case String(GatingType.AssetId):
      for (let i = 0; i < assetIds.length && i < 4; i++) {
        fixedLengthArray[i] = assetIds[i].value !== '' ? assetIds[i].value : '0'
      }

      if (minBalance !== '' && !assets[0]) {
        throw new Error('Missing asset decimals for calculating minimum balance.')
      }

      return {
        entryGatingAssets: fixedLengthArray.sort((a, b) => Number(b) - Number(a)),
        gatingAssetMinBalance:
          minBalance === '' || assetIds.length > 1
            ? '1'
            : convertToBaseUnits(minBalance, assets[0]!.params.decimals).toString(),
      }
    case String(GatingType.CreatorNfd):
      return {
        entryGatingAssets: [nfdCreatorAppId.toString(), '0', '0', '0'],
        gatingAssetMinBalance: '1',
      }
    case String(GatingType.SegmentNfd):
      return {
        entryGatingAssets: [nfdParentAppId.toString(), '0', '0', '0'],
        gatingAssetMinBalance: '1',
      }
    default:
      return {
        entryGatingAssets: ['0', '0', '0', '0'],
        gatingAssetMinBalance: '0',
      }
  }
}

/**
 * Calculate the maximum total stake based on the validator's configuration and protocol constraints
 * @param {Validator} validator - Validator object
 * @param {Constraints} constraints - Protocol constraints object
 * @returns {bigint} Maximum total stake
 */
export function calculateMaxStake(validator: Validator, constraints?: Constraints): bigint {
  if (validator.state.numPools === 0 || !constraints) {
    return BigInt(0)
  }

  const protocolMaxStake = constraints.maxAlgoPerValidator

  const numPools = BigInt(validator.state.numPools)
  const maxAlgoPerPool = validator.config.maxAlgoPerPool || constraints.maxAlgoPerPool
  const maxStake = maxAlgoPerPool * numPools

  return maxStake < protocolMaxStake ? maxStake : protocolMaxStake
}

/**
 * Calculate the maximum number of stakers based on the validator's configuration and protocol constraints
 * @param {Validator} validator - Validator object
 * @param {Constraints} constraints - Protocol constraints object
 * @returns {number} Maximum number of stakers
 */
export function calculateMaxStakers(validator: Validator, constraints?: Constraints): number {
  const maxStakersPerPool = constraints?.maxStakersPerPool || 0
  const maxStakers = maxStakersPerPool * validator.state.numPools

  return maxStakers
}

/**
 * Check if staking is disabled based on the validator's state and protocol constraints
 * @param {string | null} activeAddress - Active wallet address
 * @param {Validator} validator - Validator object
 * @param {Constraints} constraints - Protocol constraints object
 * @returns {boolean} Whether staking is disabled
 */
export function isStakingDisabled(
  activeAddress: string | null,
  validator: Validator,
  constraints?: Constraints,
): boolean {
  if (!activeAddress) {
    return true
  }
  const { numPools, totalStakers, totalAlgoStaked } = validator.state

  const noPools = numPools === 0

  const maxStake = calculateMaxStake(validator, constraints)
  const maxStakeReached = Number(totalAlgoStaked) >= Number(maxStake)

  const maxStakersPerPool = constraints?.maxStakersPerPool || 0
  const maxStakers = maxStakersPerPool * numPools
  const maxStakersReached = totalStakers >= maxStakers

  return noPools || maxStakersReached || maxStakeReached || isSunsetted(validator)
}

/**
 * Check if unstaking is disabled based on the validator's state and staking data
 * @param {string | null} activeAddress - Active wallet address
 * @param {Validator} validator - Validator object
 * @param {StakerValidatorData[]} stakesByValidator - Staking data for the active address
 * @returns {boolean} Whether unstaking is disabled
 */
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

/**
 * Check if adding a pool is disabled based on the validator's state and protocol constraints
 * @param {string | null} activeAddress - Active wallet address
 * @param {Validator} validator - Validator object
 * @param {Constraints} constraints - Protocol constraints object
 * @returns {boolean} Whether adding a pool is disabled
 */
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

  return !hasAvailableSlots || isSunsetted(validator)
}

/**
 * Check if a validator is sunsetting or has sunsetted
 * @param {Validator} validator - Validator object
 * @returns {boolean} Whether the validator is sunsetting or has sunsetted
 */
export function isSunsetting(validator: Validator): boolean {
  return validator.config.sunsettingOn > 0
}

/**
 * Check if a validator has sunsetted
 * @param {Validator} validator - Validator object
 * @returns {boolean} Whether the validator has sunsetted
 */
export function isSunsetted(validator: Validator): boolean {
  return validator.config.sunsettingOn > 0
    ? dayjs.unix(validator.config.sunsettingOn).isBefore(dayjs())
    : false
}

/**
 * Check if a validator has a migration set
 * @param {Validator} validator - Validator object
 * @returns {boolean} Whether the validator has a migration set
 */
export function isMigrationSet(validator: Validator): boolean {
  return validator.config.sunsettingTo > 0
}

/**
 * Check if the active address can manage a validator
 * @param {string | null} activeAddress - Active wallet address
 * @param {Validator} validator - Validator object
 * @returns {boolean} Whether the active address can manage the provided validator
 */
export function canManageValidator(activeAddress: string | null, validator: Validator): boolean {
  if (!activeAddress) {
    return false
  }
  const { owner, manager } = validator.config
  return owner === activeAddress || manager === activeAddress
}

/**
 * Returns the entry gating value to verify when adding stake.
 * Depending on the gating type, network requests may be required to fetch additional data.
 * @param {Validator | null} validator - Validator object
 * @param {string | null} activeAddress - Active wallet address
 * @param {AssetHolding[]} heldAssets - Assets held by the active address
 * @returns {number} Entry gating value to verify, or 0 if none found
 */
export async function fetchValueToVerify(
  validator: Validator | null,
  activeAddress: string | null,
  heldAssets: AssetHolding[],
): Promise<number> {
  if (!validator || !activeAddress) {
    throw new Error('Validator or active address not found')
  }

  const { entryGatingType, entryGatingAddress, entryGatingAssets } = validator.config
  const minBalance = Number(validator.config.gatingAssetMinBalance)

  if (entryGatingType === GatingType.CreatorAccount) {
    const creatorAddress = entryGatingAddress
    const accountInfo = await fetchAccountInformation(creatorAddress)

    if (accountInfo['created-assets']) {
      const assetIds = accountInfo['created-assets'].map((asset) => asset.index)
      return findValueToVerify(heldAssets, assetIds, minBalance)
    }
  }

  if (entryGatingType === GatingType.AssetId) {
    const assetIds = entryGatingAssets.filter((asset) => asset !== 0)
    return findValueToVerify(heldAssets, assetIds, minBalance)
  }

  if (entryGatingType === GatingType.CreatorNfd) {
    const nfdAppId = entryGatingAssets[0]
    const nfd = await fetchNfd(nfdAppId, { view: 'tiny' })
    const addresses = nfd.caAlgo || []

    const promises = addresses.map((address) => fetchAccountInformation(address))
    const accountsInfo = await Promise.all(promises)
    const assetIds = accountsInfo
      .map((accountInfo) => accountInfo['created-assets'])
      .flat()
      .filter((asset) => !!asset)
      .map((asset) => asset!.index)

    return findValueToVerify(heldAssets, assetIds, minBalance)
  }

  if (entryGatingType === GatingType.SegmentNfd) {
    const parentAppID = entryGatingAssets[0]

    let offset = 0
    const limit = 20
    let hasMoreRecords = true

    while (hasMoreRecords) {
      const params: NfdSearchV2Params = {
        parentAppID,
        owner: activeAddress,
        view: 'brief',
        limit: limit,
        offset: offset,
      }

      try {
        const result = await fetchNfdSearch(params, { cache: false })

        if (result.nfds.length === 0) {
          return 0
        }

        const nfdSegment = result.nfds.find((nfd) =>
          heldAssets.some((asset) => asset['asset-id'] === nfd.asaID),
        )

        if (nfdSegment) {
          return nfdSegment.appID || 0
        }

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

    return 0
  }

  return 0
}

/**
 * Find the first gating asset held by the active address that meets the minimum balance requirement
 * @param {AssetHolding[]} heldAssets - Assets held by the active address
 * @param {number[]} gatingAssets - Array of gating assets
 * @param {number} minBalance - Minimum balance required for gating assets
 * @returns {number} Gating asset ID that meets the minimum balance requirement or 0 if not found
 */
export function findValueToVerify(
  heldAssets: AssetHolding[],
  gatingAssets: number[],
  minBalance: number,
): number {
  const asset = heldAssets.find(
    (asset) => gatingAssets.includes(asset['asset-id']) && asset.amount >= minBalance,
  )
  return asset?.['asset-id'] || 0
}

/**
 * Calculate the maximum amount of algo that can be staked based on the validator's configuration
 * @param {Validator} validator - Validator object
 * @param {Constraints} constraints - Protocol constraints object
 * @returns {number} Maximum amount of algo that can be staked
 */
export function calculateMaxAvailableToStake(
  validator: Validator,
  constraints?: Constraints,
): number {
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
 * Calculate rewards eligibility percentage for a staker based on their entry round and last pool payout round.
 * @param {number} epochRoundLength - Validator payout frequency in rounds
 * @param {number} lastPoolPayoutRound - Last pool payout round number
 * @param {number} entryRound - Staker entry round
 * @returns {number | null} Rewards eligibility percentage, or null if any input parameters are zero/undefined
 */
export function calculateRewardEligibility(
  epochRoundLength: number = 0,
  lastPoolPayoutRound: number = 0,
  entryRound: number = 0,
): number | null {
  if (epochRoundLength === 0 || lastPoolPayoutRound === 0 || entryRound === 0) {
    return null
  }

  // Calculate the next payout round
  const currentEpochStartRound = lastPoolPayoutRound - (lastPoolPayoutRound % epochRoundLength)
  const nextPayoutRound = currentEpochStartRound + epochRoundLength

  // If the entry round is greater than or equal to the next epoch, eligibility is 0%
  if (entryRound >= nextPayoutRound) {
    return 0
  }

  // Calculate the effective rounds remaining in the current epoch
  const remainingRoundsInEpoch = Math.max(0, nextPayoutRound - entryRound)

  // Calculate eligibility as a percentage of the epoch length
  const eligibilePercent = (remainingRoundsInEpoch / epochRoundLength) * 100

  // Ensure eligibility is within 0-100% range
  const rewardEligibility = Math.max(0, Math.min(eligibilePercent, 100))

  // Round down to the nearest integer
  return Math.floor(rewardEligibility)
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

export async function fetchRemainingRewardsBalance(validator: Validator): Promise<bigint> {
  const { rewardTokenId } = validator.config
  const { rewardTokenHeldBack } = validator.state

  if (!rewardTokenId) {
    return BigInt(0)
  }

  const poolAppId = validator.pools[0].poolAppId
  const poolAddress = algosdk.getApplicationAddress(poolAppId)

  const accountAssetInfo = await fetchAccountAssetInformation(poolAddress, rewardTokenId)
  const rewardTokenAmount = BigInt(accountAssetInfo['asset-holding'].amount)

  const remainingBalance = rewardTokenAmount - rewardTokenHeldBack

  if (remainingBalance < BigInt(0)) {
    return BigInt(0)
  }

  return remainingBalance
}
