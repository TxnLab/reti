import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import algosdk from 'algosdk'
import { z } from 'zod'
import { StakerValidatorData } from '@/interfaces/staking'
import {
  Constraints,
  NodeInfo,
  NodePoolAssignmentConfig,
  RawNodePoolAssignmentConfig,
  Validator,
  ValidatorConfig,
  ValidatorConfigRaw,
  ValidatorState,
  ValidatorStateRaw,
} from '@/interfaces/validator'
import { dayjs } from '@/utils/dayjs'
import { isValidName } from '@/utils/nfd'

export function transformValidatorData(
  rawConfig: ValidatorConfigRaw,
  rawState: ValidatorStateRaw,
): Validator {
  const config: ValidatorConfig = {
    ID: rawConfig[0],
    Owner: rawConfig[1],
    Manager: rawConfig[2],
    NFDForInfo: rawConfig[3],
    MustHoldCreatorNFT: rawConfig[4],
    GatingAssetMinBalance: rawConfig[5],
    RewardTokenID: rawConfig[6],
    RewardPerPayout: rawConfig[7],
    PayoutEveryXMins: rawConfig[8],
    PercentToValidator: rawConfig[9],
    ValidatorCommissionAddress: rawConfig[10],
    MinEntryStake: rawConfig[11],
    MaxAlgoPerPool: rawConfig[12],
    PoolsPerNode: rawConfig[13],
    SunsettingOn: rawConfig[14],
    SunsettingTo: rawConfig[15],
  }

  const state: ValidatorState = {
    NumPools: rawState[0],
    TotalStakers: rawState[1],
    TotalAlgoStaked: rawState[2],
    RewardTokenHeldBack: rawState[3],
  }

  return {
    id: Number(config.ID),
    owner: config.Owner,
    manager: config.Manager,
    nfd: Number(config.NFDForInfo),
    payoutFrequency: Number(config.PayoutEveryXMins),
    commission: Number(config.PercentToValidator),
    commissionAccount: config.ValidatorCommissionAddress,
    minStake: Number(config.MinEntryStake),
    maxStake: Number(config.MaxAlgoPerPool),
    poolsPerNode: Number(config.PoolsPerNode),
    sunsetOn: Number(config.SunsettingOn),
    sunsetTo: Number(config.SunsettingTo),
    numPools: Number(state.NumPools),
    numStakers: Number(state.TotalStakers),
    totalStaked: Number(state.TotalAlgoStaked),
    rewardTokenHeldBack: Number(state.RewardTokenHeldBack),
  }
}

export function transformNodePoolAssignment(
  rawConfig: RawNodePoolAssignmentConfig,
): NodePoolAssignmentConfig {
  return rawConfig[0].flat()
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
      Owner: z
        .string()
        .refine((val) => val !== '', {
          message: 'Required field',
        })
        .refine((val) => algosdk.isValidAddress(val), {
          message: 'Invalid Algorand address',
        }),
      Manager: z
        .string()
        .refine((val) => val !== '', {
          message: 'Required field',
        })
        .refine((val) => algosdk.isValidAddress(val), {
          message: 'Invalid Algorand address',
        }),
      NFDForInfo: z
        .string()
        .refine((val) => val === '' || isValidName(val), {
          message: 'NFD name is invalid',
        })
        .optional(),
      MustHoldCreatorNFT: z
        .string()
        .refine((val) => val === '' || algosdk.isValidAddress(val), {
          message: 'Invalid Algorand address',
        })
        .optional(),
      GatingAssetMinBalance: z
        .string()
        .refine((val) => val === '' || (!isNaN(Number(val)) && Number(val) > 0), {
          message: 'Invalid minimum balance',
        })
        .optional(),
      RewardTokenID: z
        .string()
        .refine(
          (val) =>
            val === '' || (!isNaN(Number(val)) && Number.isInteger(Number(val)) && Number(val) > 0),
          {
            message: 'Invalid reward token ID',
          },
        )
        .optional(),
      RewardPerPayout: z
        .string()
        .refine((val) => val === '' || (!isNaN(Number(val)) && Number(val) > 0), {
          message: 'Invalid reward amount per payout',
        })
        .optional(),
      PayoutEveryXMins: z
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
      PercentToValidator: z
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
      ValidatorCommissionAddress: z
        .string()
        .refine((val) => val !== '', {
          message: 'Required field',
        })
        .refine((val) => algosdk.isValidAddress(val), {
          message: 'Invalid Algorand address',
        }),
      MinEntryStake: z
        .string()
        .refine((val) => val !== '', {
          message: 'Required field',
        })
        .refine((val) => !isNaN(Number(val)) && Number.isInteger(Number(val)) && Number(val) > 0, {
          message: 'Must be a positive integer',
        })
        .refine((val) => AlgoAmount.Algos(Number(val)).microAlgos >= constraints.minEntryStake, {
          message: `Must be at least ${AlgoAmount.MicroAlgos(constraints.minEntryStake).algos} ALGO`,
        }),
      MaxAlgoPerPool: z
        .string()
        .refine((val) => val !== '', {
          message: 'Required field',
        })
        .refine((val) => !isNaN(Number(val)) && Number.isInteger(Number(val)) && Number(val) > 0, {
          message: 'Must be a positive integer',
        })
        .refine((val) => AlgoAmount.Algos(Number(val)).microAlgos <= constraints.maxAlgoPerPool, {
          message: `Cannot exceed ${AlgoAmount.MicroAlgos(constraints.maxAlgoPerPool).algos} ALGO`,
        }),
      PoolsPerNode: z
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
      SunsettingOn: z
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
      SunsettingTo: z
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
    .required()
}

export function calculateMaxStake(validator: Validator, algos = false): number {
  // @todo: rename maxStake to maxStakePerPool
  const { numPools, maxStake: maxStakePerPool } = validator
  const maxStake = maxStakePerPool * numPools

  if (algos) {
    return AlgoAmount.MicroAlgos(maxStake).algos
  }

  return maxStake
}

export function calculateMaxStakers(validator: Validator): number {
  // @todo: fetch max stakers from contract
  const maxStakersPerPool = 200
  const maxStakers = maxStakersPerPool * validator.numPools

  return maxStakers
}

export function isStakingDisabled(validator: Validator): boolean {
  // @todo: rename maxStake to maxStakePerPool
  const { numPools, numStakers, totalStaked, maxStake: maxStakePerPool } = validator

  // @todo: fetch max stakers from contract
  const maxStakersPerPool = 200

  const maxStakers = maxStakersPerPool * numPools
  const maxStake = maxStakePerPool * numPools

  const noPools = numPools === 0
  const maxStakersReached = numStakers >= maxStakers
  const maxStakeReached = totalStaked >= maxStake

  return noPools || maxStakersReached || maxStakeReached
}

export function isUnstakingDisabled(
  validator: Validator,
  stakesByValidator: StakerValidatorData[],
): boolean {
  const noPools = validator.numPools === 0
  const validatorHasStake = stakesByValidator.some((stake) => stake.validatorId === validator.id)

  return noPools || !validatorHasStake
}

export function isAddingPoolDisabled(validator: Validator): boolean {
  // @todo: define totalNodes as global constant or fetch from protocol constraints
  const totalNodes = 4
  const { numPools, poolsPerNode } = validator

  const hasAvailableSlots = numPools < poolsPerNode * totalNodes

  return !hasAvailableSlots
}

export function canManageValidator(validator: Validator, activeAddress: string): boolean {
  return validator.owner === activeAddress || validator.manager === activeAddress
}
