import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import algosdk from 'algosdk'
import { RefinementCtx, z } from 'zod'
import {
  GATING_TYPE_ASSETS_CREATED_BY,
  GATING_TYPE_ASSET_ID,
  GATING_TYPE_CREATED_BY_NFD_ADDRESSES,
  GATING_TYPE_NONE,
  GATING_TYPE_SEGMENT_OF_NFD,
} from '@/constants/gating'
import { Constraints } from '@/interfaces/validator'
import { isValidName, isValidRoot } from '@/utils/nfd'

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
  payoutEveryXMins: (constraints: Constraints) => {
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
      .refine((val) => !isNaN(Number(val)) && Number.isInteger(Number(val)) && Number(val) > 0, {
        message: 'Must be a positive integer',
      })
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const entryGatingRefinement = (data: any, ctx: RefinementCtx) => {
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
      } else if (!entryGatingAssets.some((asset: { value: string }) => asset.value !== '')) {
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
}
