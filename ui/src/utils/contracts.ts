import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import algosdk from 'algosdk'
import { z } from 'zod'
import { StakerValidatorData } from '@/interfaces/staking'
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
} from '@/interfaces/validator'
import { dayjs } from '@/utils/dayjs'
import { isValidName } from '@/utils/nfd'

export function transformValidatorConfig(rawConfig: RawValidatorConfig): ValidatorConfig {
  return {
    id: Number(rawConfig[0]),
    owner: rawConfig[1],
    manager: rawConfig[2],
    nfdForInfo: Number(rawConfig[3]),
    entryGatingType: Number(rawConfig[4]),
    entryGatingValue: rawConfig[5],
    gatingAssetMinBalance: rawConfig[6],
    rewardTokenId: Number(rawConfig[7]),
    rewardPerPayout: rawConfig[8],
    payoutEveryXMins: Number(rawConfig[9]),
    percentToValidator: Number(rawConfig[10]),
    validatorCommissionAddress: rawConfig[11],
    minEntryStake: rawConfig[12],
    maxAlgoPerPool: rawConfig[13],
    poolsPerNode: Number(rawConfig[14]),
    sunsettingOn: Number(rawConfig[15]),
    sunsettingTo: Number(rawConfig[16]),
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
      nfdForInfo: z
        .string()
        .refine((val) => val === '' || isValidName(val), {
          message: 'NFD name is invalid',
        })
        .optional(),
      entryGatingType: z.string().optional(),
      entryGatingValue: z.string().optional(),
      gatingAssetMinBalance: z
        .string()
        .refine((val) => val === '' || (!isNaN(Number(val)) && Number(val) > 0), {
          message: 'Invalid minimum balance',
        })
        .optional(),
      rewardTokenId: z
        .string()
        .refine(
          (val) =>
            val === '' || (!isNaN(Number(val)) && Number.isInteger(Number(val)) && Number(val) > 0),
          {
            message: 'Invalid reward token ID',
          },
        )
        .optional(),
      rewardPerPayout: z
        .string()
        .refine((val) => val === '' || (!isNaN(Number(val)) && Number(val) > 0), {
          message: 'Invalid reward amount per payout',
        })
        .optional(),
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
      maxAlgoPerPool: z
        .string()
        .refine(
          (val) =>
            val === '' ||
            (!isNaN(Number(val)) && Number.isInteger(Number(val)) && Number(val) >= 0),
          {
            message: 'Must be a positive integer',
          },
        )
        .refine(
          (val) =>
            val === '' || AlgoAmount.Algos(Number(val)).microAlgos <= constraints.maxAlgoPerPool,
          {
            message: `Cannot exceed ${AlgoAmount.MicroAlgos(Number(constraints.maxAlgoPerPool)).algos} ALGO`,
          },
        )
        .optional(),
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
      sunsettingOn: z
        .string()
        .refine(
          (val) =>
            val === '' ||
            (Number.isInteger(Number(val)) && dayjs.unix(Number(val)).isAfter(dayjs())),
          {
            message: 'Must be a valid UNIX timestamp and later than current time',
          },
        )
        .optional(),
      sunsettingTo: z
        .string()
        .refine(
          (val) =>
            val === '' || (!isNaN(Number(val)) && Number.isInteger(Number(val)) && Number(val) > 0),
          {
            message: 'Invalid Validator ID',
          },
        )
        .optional(),
    })
    .superRefine((data, ctx) => {
      const { entryGatingType, entryGatingValue } = data

      switch (entryGatingType) {
        case '0':
          if (entryGatingValue !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingValue'],
              message: 'EntryGatingValue must be empty when entryGatingType is 0',
            })
          }
          break
        case '1':
          if (typeof entryGatingValue !== 'string' || !algosdk.isValidAddress(entryGatingValue)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingValue'],
              message:
                'EntryGatingValue must be a valid Algorand address when entryGatingType is 1',
            })
          }
          break
        case '2':
        case '3':
        case '4':
          if (
            !(
              !isNaN(Number(entryGatingValue)) &&
              Number.isInteger(Number(entryGatingValue)) &&
              Number(entryGatingValue) > 0
            )
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingValue'],
              message:
                'entryGatingValue must be a positive integer when entryGatingType is 2, 3, or 4',
            })
          }
          break
        default:
          break
      }
    })
}

export function calculateMaxStake(validator: Validator, algos = false): number {
  const { numPools } = validator.state
  const { maxAlgoPerPool } = validator.config

  const maxStake = Number(maxAlgoPerPool) * numPools

  if (algos) {
    return AlgoAmount.MicroAlgos(maxStake).algos
  }

  return maxStake
}

export function calculateMaxStakers(validator: Validator): number {
  // @todo: fetch max stakers from contract
  const maxStakersPerPool = 200
  const maxStakers = maxStakersPerPool * validator.state.numPools

  return maxStakers
}

export function isStakingDisabled(validator: Validator): boolean {
  const { numPools, totalStakers, totalAlgoStaked } = validator.state
  const { maxAlgoPerPool } = validator.config

  // @todo: fetch max stakers from contract
  const maxStakersPerPool = 200

  const maxStakers = maxStakersPerPool * numPools
  const maxStake = Number(maxAlgoPerPool) * numPools

  const noPools = numPools === 0
  const maxStakersReached = totalStakers >= maxStakers
  const maxStakeReached = Number(totalAlgoStaked) >= maxStake

  return noPools || maxStakersReached || maxStakeReached
}

export function isUnstakingDisabled(
  validator: Validator,
  stakesByValidator: StakerValidatorData[],
): boolean {
  const noPools = validator.state.numPools === 0
  const validatorHasStake = stakesByValidator.some((stake) => stake.validatorId === validator.id)

  return noPools || !validatorHasStake
}

export function isAddingPoolDisabled(validator: Validator): boolean {
  // @todo: define totalNodes as global constant or fetch from protocol constraints
  const totalNodes = 4
  const { numPools } = validator.state
  const { poolsPerNode } = validator.config

  const hasAvailableSlots = numPools < poolsPerNode * totalNodes

  return !hasAvailableSlots
}

export function canManageValidator(validator: Validator, activeAddress: string): boolean {
  const { owner, manager } = validator.config
  return owner === activeAddress || manager === activeAddress
}
