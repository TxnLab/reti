import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import algosdk from 'algosdk'
import { RefinementCtx, z } from 'zod'
import { ALGORAND_ZERO_ADDRESS_STRING } from '@/constants/accounts'
import { GatingType } from '@/constants/gating'
import { Asset } from '@/interfaces/algod'
import { Constraints } from '@/interfaces/validator'
import { convertToBaseUnits } from '@/utils/format'
import { isValidName, isValidRoot } from '@/utils/nfd'

/**
 * Validator schema definitions for form validation
 * @see {@link https://zod.dev}
 * @see {@link https://github.com/react-hook-form/resolvers#zod}
 */
export const validatorSchemas = {
  owner: () => {
    return z
      .string()
      .refine((val) => val !== '', {
        message: 'Required field',
      })
      .refine((val) => algosdk.isValidAddress(val), {
        message: 'Invalid Algorand address',
      })
  },
  manager: () => {
    return z
      .string()
      .refine((val) => val !== '', {
        message: 'Required field',
      })
      .refine((val) => algosdk.isValidAddress(val), {
        message: 'Invalid Algorand address',
      })
  },
  nfdForInfo: () => {
    return z.string().refine((val) => val === '' || isValidName(val), {
      message: 'NFD name is invalid',
    })
  },
  entryGatingType: () => z.string(),
  entryGatingAddress: () => z.string(),
  entryGatingAssets: () => {
    return z.array(
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
    )
  },
  entryGatingNfdCreator: () => {
    return z.string().refine((val) => val === '' || isValidName(val), {
      message: 'NFD name is invalid',
    })
  },
  entryGatingNfdParent: () => {
    return z.string().refine((val) => val === '' || isValidRoot(val), {
      message: 'Root/parent NFD name is invalid',
    })
  },
  gatingAssetMinBalance: () => {
    return z.string().refine((val) => val === '' || (!isNaN(Number(val)) && Number(val) > 0), {
      message: 'Invalid minimum balance',
    })
  },
  rewardTokenId: () => {
    return z
      .string()
      .refine(
        (val) =>
          val === '' || (!isNaN(Number(val)) && Number.isInteger(Number(val)) && Number(val) > 0),
        {
          message: 'Invalid reward token id',
        },
      )
  },
  rewardPerPayout: () => {
    return z.string().refine((val) => val === '' || (!isNaN(Number(val)) && Number(val) > 0), {
      message: 'Invalid reward amount per payout',
    })
  },
  epochRoundLength: (constraints: Constraints) => {
    return z
      .string()
      .refine((val) => val !== '', {
        message: 'Required field',
      })
      .refine((val) => !isNaN(Number(val)) && Number.isInteger(Number(val)) && Number(val) > 0, {
        message: 'Must be a positive integer',
      })
      .superRefine((val, ctx) => {
        const minutes = Number(val)
        const { payoutRoundsMin, payoutRoundsMax } = constraints

        if (minutes < payoutRoundsMin) {
          ctx.addIssue({
            code: z.ZodIssueCode.too_small,
            minimum: payoutRoundsMin,
            type: 'number',
            inclusive: true,
            message: `Epoch length must be at least ${payoutRoundsMin} minute${payoutRoundsMin === 1 ? '' : 's'}`,
          })
        }

        if (minutes > payoutRoundsMax) {
          ctx.addIssue({
            code: z.ZodIssueCode.too_big,
            maximum: payoutRoundsMax,
            type: 'number',
            inclusive: true,
            message: `Epoch length cannot exceed ${payoutRoundsMax} minutes`,
          })
        }
      })
  },
  percentToValidator: (constraints: Constraints) => {
    return z
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
      })
  },
  validatorCommissionAddress: () => {
    return z
      .string()
      .refine((val) => val !== '', {
        message: 'Required field',
      })
      .refine((val) => algosdk.isValidAddress(val), {
        message: 'Invalid Algorand address',
      })
  },
  minEntryStake: (constraints: Constraints) => {
    return z
      .string()
      .refine((val) => val !== '', {
        message: 'Required field',
      })
      .refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
        message: 'Must be a positive number',
      })
      .refine(
        (val) => {
          const match = val.match(/^\d+(\.\d{1,6})?$/)
          return match !== null
        },
        {
          message: 'Cannot have more than 6 decimal places',
        },
      )
      .refine((val) => AlgoAmount.Algos(Number(val)).microAlgos >= constraints.minEntryStake, {
        message: `Must be at least ${AlgoAmount.MicroAlgos(Number(constraints.minEntryStake)).algos} ALGO`,
      })
  },
  poolsPerNode: (constraints: Constraints) => {
    return z
      .string()
      .refine((val) => val !== '', {
        message: 'Required field',
      })
      .refine((val) => !isNaN(Number(val)) && Number.isInteger(Number(val)) && Number(val) > 0, {
        message: 'Must be a positive integer',
      })
      .refine((val) => Number(val) <= constraints.maxPoolsPerNode, {
        message: `Cannot exceed ${constraints.maxPoolsPerNode} pools per node`,
      })
  },
  enableSunset: () => z.boolean(),
  sunsettingOn: () => {
    return z.date({
      required_error: 'Required field',
    })
  },
  sunsettingTo: () => {
    return z
      .string()
      .refine(
        (val) =>
          val === '' || (!isNaN(Number(val)) && Number.isInteger(Number(val)) && Number(val) > 0),
        {
          message: 'Invalid validator id',
        },
      )
  },
}

/**
 * Validator schema refinement for reward token
 * @param {any} data - The form data
 * @param {RefinementCtx} ctx - The refinement context
 * @param {number | bigint} decimals - The reward token's decimals value
 */
export const rewardTokenRefinement = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  ctx: RefinementCtx,
  decimals?: number | bigint,
) => {
  const { rewardTokenId, rewardPerPayout } = data

  if (Number(rewardTokenId) > 0) {
    if (rewardPerPayout === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rewardPerPayout'],
        message: 'Required field',
      })
    } else if (decimals) {
      const regex = new RegExp(`^\\d+(\\.\\d{1,${Number(decimals)}})?$`)

      if (!regex.test(rewardPerPayout)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rewardPerPayout'],
          message: `Cannot have more than ${decimals} decimal places`,
        })
      }
    }
  }

  if (Number(rewardTokenId) > 0 && rewardPerPayout === '') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rewardPerPayout'],
      message: 'Reward per payout must be set when reward token is enabled',
    })
  }
}

/**
 * Validator schema refinement for entry gating
 * @param {any} data - The form data
 * @param {RefinementCtx} ctx - The refinement context
 * @param {Array<Asset | null>} assets - The gating assets
 */
export const entryGatingRefinement = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  ctx: RefinementCtx,
  assets: Array<Asset | null>,
) => {
  const {
    entryGatingType,
    entryGatingAddress,
    entryGatingAssets,
    entryGatingNfdCreator,
    entryGatingNfdParent,
    gatingAssetMinBalance,
  } = data

  switch (entryGatingType) {
    case String(GatingType.None):
      if (!['', ALGORAND_ZERO_ADDRESS_STRING].includes(entryGatingAddress)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entryGatingAddress'],
          message: 'entryGatingAddress should not be set when entryGatingType is None',
        })
      } else if (entryGatingAssets.length > 1 || entryGatingAssets[0].value !== '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entryGatingAssets'],
          message: 'entryGatingAssets should not be set when entryGatingType is None',
        })
      } else if (entryGatingNfdCreator !== '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entryGatingNfdCreator'],
          message: 'entryGatingNfdCreator should not be set when entryGatingType is None',
        })
      } else if (entryGatingNfdParent !== '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entryGatingNfdParent'],
          message: 'entryGatingNfdParent should not be set when entryGatingType is None',
        })
      }
      break
    case String(GatingType.CreatorAccount):
      if (typeof entryGatingAddress !== 'string' || !algosdk.isValidAddress(entryGatingAddress)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entryGatingAddress'],
          message: 'Invalid Algorand address',
        })
      } else if (entryGatingAssets.length > 1 || entryGatingAssets[0].value !== '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entryGatingAssets'],
          message: 'entryGatingAssets should not be set when entryGatingType is CreatorAccount',
        })
      } else if (entryGatingNfdCreator !== '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entryGatingNfdCreator'],
          message: 'entryGatingNfdCreator should not be set when entryGatingType is CreatorAccount',
        })
      } else if (entryGatingNfdParent !== '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entryGatingNfdParent'],
          message: 'entryGatingNfdParent should not be set when entryGatingType is CreatorAccount',
        })
      }
      break
    case String(GatingType.AssetId):
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
      } else if (!entryGatingAssets.some((asset: { value: string }) => asset.value !== '')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entryGatingAssets'],
          message: 'Must provide at least one gating asset',
        })
      } else if (!['', ALGORAND_ZERO_ADDRESS_STRING].includes(entryGatingAddress)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entryGatingAddress'],
          message: 'entryGatingAddress should not be set when entryGatingType is AssetId',
        })
      } else if (entryGatingNfdCreator !== '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entryGatingNfdCreator'],
          message: 'entryGatingNfdCreator should not be set when entryGatingType is AssetId',
        })
      } else if (entryGatingNfdParent !== '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entryGatingNfdParent'],
          message: 'entryGatingNfdParent should not be set when entryGatingType is AssetId',
        })
      }
      break
    case String(GatingType.CreatorNfd):
      if (!['', ALGORAND_ZERO_ADDRESS_STRING].includes(entryGatingAddress)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entryGatingAddress'],
          message: 'entryGatingAddress should not be set when entryGatingType is CreatorNfd',
        })
      } else if (entryGatingAssets.length > 1 || entryGatingAssets[0].value !== '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entryGatingAssets'],
          message: 'entryGatingAssets should not be set when entryGatingType is CreatorNfd',
        })
      } else if (entryGatingNfdParent !== '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entryGatingNfdParent'],
          message: 'entryGatingNfdParent should not be set when entryGatingType is CreatorNfd',
        })
      }
      break
    case String(GatingType.SegmentNfd):
      if (!['', ALGORAND_ZERO_ADDRESS_STRING].includes(entryGatingAddress)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entryGatingAddress'],
          message: 'entryGatingAddress should not be set when entryGatingType is SegmentNfd',
        })
      } else if (entryGatingAssets.length > 1 || entryGatingAssets[0].value !== '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entryGatingAssets'],
          message: 'entryGatingAssets should not be set when entryGatingType is SegmentNfd',
        })
      } else if (entryGatingNfdCreator !== '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entryGatingNfdCreator'],
          message: 'entryGatingNfdCreator should not be set when entryGatingType is SegmentNfd',
        })
      }
      break
    default:
      break
  }

  if (entryGatingType === String(GatingType.AssetId)) {
    if (entryGatingAssets.length === 1) {
      // gatingAssetMinBalance field is visible
      if (isNaN(Number(gatingAssetMinBalance)) || Number(gatingAssetMinBalance) < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['gatingAssetMinBalance'],
          message: 'Invalid minimum balance',
        })
      } else {
        const asset = assets.find((asset) => asset?.index === Number(entryGatingAssets[0].value))
        if (asset) {
          const minBalanceBaseUnits = convertToBaseUnits(
            gatingAssetMinBalance,
            asset.params.decimals,
          )
          if (minBalanceBaseUnits > asset.params.total) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['gatingAssetMinBalance'],
              message: `Minimum balance cannot exceed ${asset.params['unit-name'] || 'gating asset'} total supply`,
            })
          }
        }
      }
    }
  }
}
