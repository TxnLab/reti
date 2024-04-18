import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import algosdk from 'algosdk'
import { z } from 'zod'
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
import { isValidName, isValidRoot } from '@/utils/nfd'

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

export function getAddValidatorFormSchema(constraints: Constraints) {
  return z
    .object({
      owner: z
        .string()
        .refine((val) => val !== '', {
          message: 'Required field',
        })
        .refine((val) => algosdk.isValidAddress(val), {
          message: 'Invalid Algorand address',
        }),
      manager: z
        .string()
        .refine((val) => val !== '', {
          message: 'Required field',
        })
        .refine((val) => algosdk.isValidAddress(val), {
          message: 'Invalid Algorand address',
        }),
      nfdForInfo: z.string().refine((val) => val === '' || isValidName(val), {
        message: 'NFD name is invalid',
      }),
      entryGatingType: z.string(),
      entryGatingAddress: z.string(),
      entryGatingAssets: z.array(
        z.object({
          value: z
            .string()
            .refine(
              (val) =>
                val === '' ||
                (!isNaN(Number(val)) && Number.isInteger(Number(val)) && Number(val) > 0),
              {
                message: 'Invalid asset ID',
              },
            ),
        }),
      ),
      entryGatingNfdCreator: z.string().refine((val) => val === '' || isValidName(val), {
        message: 'NFD name is invalid',
      }),
      entryGatingNfdParent: z.string().refine((val) => val === '' || isValidRoot(val), {
        message: 'Root/parent NFD name is invalid',
      }),
      gatingAssetMinBalance: z
        .string()
        .refine((val) => val === '' || (!isNaN(Number(val)) && Number(val) > 0), {
          message: 'Invalid minimum balance',
        }),
      rewardTokenId: z
        .string()
        .refine(
          (val) =>
            val === '' || (!isNaN(Number(val)) && Number.isInteger(Number(val)) && Number(val) > 0),
          {
            message: 'Invalid reward token id',
          },
        ),
      rewardPerPayout: z
        .string()
        .refine((val) => val === '' || (!isNaN(Number(val)) && Number(val) > 0), {
          message: 'Invalid reward amount per payout',
        }),
      payoutEveryXMins: z
        .string()
        .refine((val) => val !== '', {
          message: 'Required field',
        })
        .refine((val) => !isNaN(Number(val)) && Number.isInteger(Number(val)) && Number(val) > 0, {
          message: 'Must be a positive integer',
        })
        .superRefine((val, ctx) => {
          const minutes = Number(val)
          const { payoutMinsMin, payoutMinsMax } = constraints

          if (minutes < payoutMinsMin) {
            ctx.addIssue({
              code: z.ZodIssueCode.too_small,
              minimum: payoutMinsMin,
              type: 'number',
              inclusive: true,
              message: `Epoch length must be at least ${payoutMinsMin} minute${payoutMinsMin === 1 ? '' : 's'}`,
            })
          }

          if (minutes > payoutMinsMax) {
            ctx.addIssue({
              code: z.ZodIssueCode.too_big,
              maximum: payoutMinsMax,
              type: 'number',
              inclusive: true,
              message: `Epoch length cannot exceed ${payoutMinsMax} minutes`,
            })
          }
        }),
      percentToValidator: z
        .string()
        .refine((val) => val !== '', {
          message: 'Required field',
        })
        .refine((val) => !isNaN(parseFloat(val)), {
          message: 'Invalid percent value',
        })
        .superRefine((val, ctx) => {
          const percent = parseFloat(val)
          const hasValidPrecision = parseFloat(percent.toFixed(4)) === percent

          if (!hasValidPrecision) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Percent value cannot have more than 4 decimal places',
            })
          }

          const percentMultiplied = percent * 10000
          const { commissionPctMin, commissionPctMax } = constraints

          if (percentMultiplied < commissionPctMin) {
            ctx.addIssue({
              code: z.ZodIssueCode.too_small,
              minimum: commissionPctMin,
              type: 'number',
              inclusive: true,
              message: `Must be at least ${commissionPctMin / 10000} percent`,
            })
          }

          if (percentMultiplied > commissionPctMax) {
            ctx.addIssue({
              code: z.ZodIssueCode.too_big,
              maximum: commissionPctMax,
              type: 'number',
              inclusive: true,
              message: `Cannot exceed ${commissionPctMax / 10000} percent`,
            })
          }
        }),
      validatorCommissionAddress: z
        .string()
        .refine((val) => val !== '', {
          message: 'Required field',
        })
        .refine((val) => algosdk.isValidAddress(val), {
          message: 'Invalid Algorand address',
        }),
      minEntryStake: z
        .string()
        .refine((val) => val !== '', {
          message: 'Required field',
        })
        .refine((val) => !isNaN(Number(val)) && Number.isInteger(Number(val)) && Number(val) > 0, {
          message: 'Must be a positive integer',
        })
        .refine((val) => AlgoAmount.Algos(Number(val)).microAlgos >= constraints.minEntryStake, {
          message: `Must be at least ${AlgoAmount.MicroAlgos(Number(constraints.minEntryStake)).algos} ALGO`,
        }),
      poolsPerNode: z
        .string()
        .refine((val) => val !== '', {
          message: 'Required field',
        })
        .refine((val) => !isNaN(Number(val)) && Number.isInteger(Number(val)) && Number(val) > 0, {
          message: 'Must be a positive integer',
        })
        .refine((val) => Number(val) <= constraints.maxPoolsPerNode, {
          message: `Cannot exceed ${constraints.maxPoolsPerNode} pools per node`,
        }),
    })
    .superRefine((data, ctx) => {
      const {
        entryGatingType,
        entryGatingAddress,
        entryGatingAssets,
        entryGatingNfdCreator,
        entryGatingNfdParent,
        gatingAssetMinBalance,
      } = data

      switch (entryGatingType) {
        case String(GATING_TYPE_NONE):
          if (entryGatingAddress !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAddress'],
              message: 'entryGatingAddress should not be set when entry gating is disabled',
            })
          } else if (entryGatingAssets.length > 1 || entryGatingAssets[0].value !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAssets'],
              message: 'entryGatingAssets should not be set when entry gating is disabled',
            })
          } else if (entryGatingNfdCreator !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingNfdCreator'],
              message: 'entryGatingNfdCreator should not be set when entry gating is disabled',
            })
          } else if (entryGatingNfdParent !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingNfdParent'],
              message: 'entryGatingNfdParent should not be set when entry gating is disabled',
            })
          }
          break
        case String(GATING_TYPE_ASSETS_CREATED_BY):
          if (
            typeof entryGatingAddress !== 'string' ||
            !algosdk.isValidAddress(entryGatingAddress)
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAddress'],
              message: 'Invalid Algorand address',
            })
          } else if (entryGatingAssets.length > 1 || entryGatingAssets[0].value !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAssets'],
              message: 'entryGatingAssets should not be set when entryGatingType is 1',
            })
          } else if (entryGatingNfdCreator !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingNfdCreator'],
              message: 'entryGatingNfdCreator should not be set when entryGatingType is 1',
            })
          } else if (entryGatingNfdParent !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingNfdParent'],
              message: 'entryGatingNfdParent should not be set when entryGatingType is 1',
            })
          }
          break
        case String(GATING_TYPE_ASSET_ID):
          if (entryGatingAssets.length === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAssets'],
              message: 'No gating asset(s) provided',
            })
          } else if (entryGatingAssets.length > 4) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAssets'],
              message: 'Cannot have more than 4 gating assets',
            })
          } else if (!entryGatingAssets.some((asset) => asset.value !== '')) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAssets'],
              message: 'Must provide at least one gating asset',
            })
          } else if (entryGatingAddress !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAddress'],
              message: 'entryGatingAddress should not be set when entryGatingType is 2',
            })
          } else if (entryGatingNfdCreator !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingNfdCreator'],
              message: 'entryGatingNfdCreator should not be set when entryGatingType is 2',
            })
          } else if (entryGatingNfdParent !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingNfdParent'],
              message: 'entryGatingNfdParent should not be set when entryGatingType is 2',
            })
          }
          break
        case String(GATING_TYPE_CREATED_BY_NFD_ADDRESSES):
          if (entryGatingAddress !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAddress'],
              message: 'entryGatingAddress should not be set when entryGatingType is 3',
            })
          } else if (entryGatingAssets.length > 1 || entryGatingAssets[0].value !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAssets'],
              message: 'entryGatingAssets should not be set when entryGatingType is 3',
            })
          } else if (entryGatingNfdParent !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingNfdParent'],
              message: 'entryGatingNfdParent should not be set when entryGatingType is 3',
            })
          }
          break
        case String(GATING_TYPE_SEGMENT_OF_NFD):
          if (entryGatingAddress !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAddress'],
              message: 'entryGatingAddress should not be set when entryGatingType is 4',
            })
          } else if (entryGatingAssets.length > 1 || entryGatingAssets[0].value !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAssets'],
              message: 'entryGatingAssets should not be set when entryGatingType is 4',
            })
          } else if (entryGatingNfdCreator !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingNfdCreator'],
              message: 'entryGatingNfdCreator should not be set when entryGatingType is 4',
            })
          }
          break
        default:
          break
      }

      const isGatingEnabled = [
        String(GATING_TYPE_ASSETS_CREATED_BY),
        String(GATING_TYPE_ASSET_ID),
        String(GATING_TYPE_CREATED_BY_NFD_ADDRESSES),
        String(GATING_TYPE_SEGMENT_OF_NFD),
      ].includes(String(entryGatingType))

      if (isGatingEnabled) {
        if (
          isNaN(Number(gatingAssetMinBalance)) ||
          !Number.isInteger(Number(gatingAssetMinBalance)) ||
          Number(gatingAssetMinBalance) <= 0
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['gatingAssetMinBalance'],
            message: 'Invalid minimum balance',
          })
        }
      } else if (gatingAssetMinBalance !== '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['gatingAssetMinBalance'],
          message: 'gatingAssetMinBalance should not be set when entry gating is disabled',
        })
      }
    })
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

export async function fetchGatingAssets(validator: Validator | null): Promise<number[]> {
  if (!validator) {
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
