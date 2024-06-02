import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet-react'
import { ArrowUpRight, MessageCircleWarning, RefreshCcw } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { useDebouncedCallback } from 'use-debounce'
import { z } from 'zod'
import { fetchAccountInformation } from '@/api/algod'
import {
  addStake,
  doesStakerNeedToPayMbr,
  fetchValidator,
  findPoolForStaker,
} from '@/api/contracts'
import { mbrQueryOptions } from '@/api/queries'
import { AlgoDisplayAmount } from '@/components/AlgoDisplayAmount'
import { Loading } from '@/components/Loading'
import { NfdThumbnail } from '@/components/NfdThumbnail'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { GatingType } from '@/constants/gating'
import { StakerPoolData, StakerValidatorData } from '@/interfaces/staking'
import { Constraints, Validator } from '@/interfaces/validator'
import { useAuthAddress } from '@/providers/AuthAddressProvider'
import { InsufficientBalanceError } from '@/utils/balanceChecker'
import {
  calculateMaxAvailableToStake,
  fetchValueToVerify,
  setValidatorQueriesData,
} from '@/utils/contracts'
import { ellipseAddressJsx } from '@/utils/ellipseAddress'
import { ExplorerLink } from '@/utils/explorer'
import { formatAlgoAmount, formatAmount } from '@/utils/format'

interface AddStakeModalProps {
  validator: Validator | null
  setValidator: React.Dispatch<React.SetStateAction<Validator | null>>
  constraints?: Constraints
  stakesByValidator: StakerValidatorData[]
}

export function AddStakeModal({
  validator,
  setValidator,
  constraints,
  stakesByValidator,
}: AddStakeModalProps) {
  const [isOpen, setIsOpen] = React.useState<boolean>(false)
  const [isSigning, setIsSigning] = React.useState<boolean>(false)
  const [targetPoolId, setTargetPoolId] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (validator) {
      setIsOpen(true)
    }
  }, [validator])

  const queryClient = useQueryClient()
  const router = useRouter()
  const { transactionSigner, activeAddress } = useWallet()
  const { authAddress, isReady } = useAuthAddress()

  const accountInfoQuery = useQuery({
    queryKey: ['account-info', activeAddress],
    queryFn: () => fetchAccountInformation(activeAddress!),
    enabled: !!activeAddress && !!validator, // wait until modal is open
  })

  const {
    amount = 0,
    'min-balance': minBalance = 0,
    assets: heldAssets = [],
  } = accountInfoQuery.data || {}

  const availableBalance = Math.max(0, amount - minBalance)

  const heldGatingAssetQuery = useQuery({
    queryKey: ['held-gating-asset', validator?.id, activeAddress],
    queryFn: () => fetchValueToVerify(validator, activeAddress, heldAssets),
    enabled: !!validator && !!accountInfoQuery.data,
  })
  const valueToVerify = heldGatingAssetQuery.data || 0

  const isLoading = accountInfoQuery.isFetching || heldGatingAssetQuery.isFetching

  const hasGatingAccess = () => {
    if (!validator) return false

    if (validator.config.entryGatingType === GatingType.None) {
      return true
    }

    return valueToVerify > 0
  }

  const mbrQuery = useQuery(mbrQueryOptions)
  const stakerMbr = mbrQuery.data?.stakerMbr || 0

  // @todo: make this a custom hook, call from higher up and pass down as prop
  const mbrRequiredQuery = useQuery({
    queryKey: ['mbr-required', activeAddress],
    queryFn: () => doesStakerNeedToPayMbr(activeAddress!, authAddress),
    enabled: !!activeAddress && isReady,
  })
  const mbrRequired = mbrRequiredQuery.data || false
  const mbrAmount = mbrRequired ? stakerMbr : 0

  const stakerPoolsData = React.useMemo<StakerPoolData[]>(
    () => stakesByValidator.find((data) => data.validatorId === validator?.id)?.pools || [],
    [stakesByValidator, validator],
  )
  const minimumStake = stakerPoolsData.length === 0 ? Number(validator?.config.minEntryStake) : 0

  const poolMaximumStake = validator ? calculateMaxAvailableToStake(validator, constraints) : 0

  const stakerMaximumStake = React.useMemo(() => {
    const estimatedFee = AlgoAmount.MicroAlgos(240_000).microAlgos
    return Math.max(0, availableBalance - mbrAmount - estimatedFee)
  }, [availableBalance, mbrAmount])

  const maximumStake = Math.min(stakerMaximumStake, poolMaximumStake || stakerMaximumStake)

  const formSchema = z.object({
    amountToStake: z
      .string()
      .refine((val) => val !== '', {
        message: 'Required field',
      })
      .refine((val) => !isNaN(Number(val)) && parseFloat(val) > 0, {
        message: 'Invalid amount',
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
      .superRefine((val, ctx) => {
        const algoAmount = parseFloat(val)
        const amountToStake = AlgoAmount.Algos(algoAmount).microAlgos

        if (validator) {
          if (amountToStake < minimumStake) {
            ctx.addIssue({
              code: z.ZodIssueCode.too_small,
              minimum: minimumStake,
              type: 'number',
              inclusive: true,
              message: `Minimum entry stake is ${formatAlgoAmount(minimumStake)} ALGO`,
            })
          }

          if (amountToStake > stakerMaximumStake) {
            ctx.addIssue({
              code: z.ZodIssueCode.too_big,
              maximum: stakerMaximumStake,
              type: 'number',
              inclusive: true,
              message: 'Exceeds available balance',
            })
          }

          if (poolMaximumStake !== undefined) {
            if (amountToStake > poolMaximumStake) {
              ctx.addIssue({
                code: z.ZodIssueCode.too_big,
                maximum: poolMaximumStake,
                type: 'number',
                inclusive: true,
                message: `Exceeds limit for validator's pools`,
              })
            }
          }
        }
      }),
  })

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: {
      amountToStake: '',
    },
  })

  const { errors, isValid } = form.formState

  const fetchTargetPoolId = React.useCallback(
    async (inputAmount?: string) => {
      try {
        const amountToStake =
          AlgoAmount.Algos(Number(inputAmount || '0')).microAlgos || minimumStake || 1

        if (!validator || !activeAddress) {
          throw new Error('Invalid/missing data')
        }
        const { poolKey } = await findPoolForStaker(
          validator.id,
          amountToStake,
          activeAddress,
          authAddress,
        )
        setTargetPoolId(poolKey.poolId)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        console.error(`Error fetching target pool: ${error.message}`)
      }
    },
    [activeAddress, authAddress, minimumStake, validator],
  )

  React.useEffect(() => {
    if (validator?.id && isReady) {
      fetchTargetPoolId()
    } else {
      setTargetPoolId(null)
    }
  }, [fetchTargetPoolId, isReady, validator?.id])

  const debouncedFetchTargetPoolId = useDebouncedCallback(async (value) => {
    const isValid = await form.trigger('amountToStake')
    if (isValid) {
      await fetchTargetPoolId(value)
    }
  }, 500)

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setIsOpen(false)
      setTimeout(() => {
        setValidator(null)
        form.setValue('amountToStake', '')
        form.clearErrors()
      }, 500)
    }
  }

  const handleSetMaxAmount = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()

    const maxAmount = String(AlgoAmount.MicroAlgos(maximumStake).algos)

    form.setValue('amountToStake', maxAmount, {
      shouldValidate: true,
    })

    debouncedFetchTargetPoolId(maxAmount)
  }

  const toastIdRef = React.useRef(`toast-${Date.now()}-${Math.random()}`)
  const TOAST_ID = toastIdRef.current

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    const toastId = `${TOAST_ID}-add-stake`

    try {
      setIsSigning(true)

      if (!activeAddress) {
        throw new Error('No wallet connected')
      }

      if (!validator) {
        throw new Error('Missing validator data')
      }

      const amountToStake = AlgoAmount.Algos(Number(data.amountToStake)).microAlgos
      const totalAmount = mbrRequired ? amountToStake + stakerMbr : amountToStake

      if (!hasGatingAccess()) {
        throw new Error('Staker does not meet gating asset requirements')
      }

      toast.loading('Sign transactions to add stake...', { id: toastId })

      const poolKey = await addStake(
        validator!.id,
        totalAmount,
        valueToVerify,
        validator!.config.rewardTokenId,
        transactionSigner,
        activeAddress,
        authAddress,
      )

      toast.success(
        <div className="flex items-center gap-x-2">
          <ArrowUpRight className="h-5 w-5 text-foreground" />
          <span>
            Added <AlgoDisplayAmount amount={amountToStake} microalgos className="font-bold" /> to
            Pool {poolKey.poolId} on Validator {poolKey.validatorId}
          </span>
        </div>,
        {
          id: toastId,
          duration: 5000,
        },
      )

      // Refetch validator data
      const newData = await fetchValidator(validator!.id)

      // Seed/update query cache with new data
      setValidatorQueriesData(queryClient, newData)

      // Invalidate other queries to update UI
      queryClient.invalidateQueries({ queryKey: ['stakes', { staker: activeAddress }] })
      queryClient.invalidateQueries({ queryKey: ['staked-info'] })
      queryClient.invalidateQueries({ queryKey: ['pools-info'] })
      router.invalidate()
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        toast.error('Insufficient balance', {
          id: toastId,
          description: error.toastMessage,
          duration: 5000,
        })
      } else {
        toast.error('Failed to add stake to pool', { id: toastId })
      }
      console.error(error)
    } finally {
      setIsSigning(false)
      setValidator(null)
      form.setValue('amountToStake', '')
      setIsOpen(false)
    }
  }

  const handleRefetchGatingAsset = async () => {
    await accountInfoQuery.refetch()
    await heldGatingAssetQuery.refetch()
  }

  const renderEntryGatingAsset = () => {
    if (!validator) {
      return null
    }

    const { entryGatingType, entryGatingAddress, entryGatingAssets } = validator.config

    switch (entryGatingType) {
      case GatingType.None:
        return 'None'
      case GatingType.CreatorAccount:
        return (
          <>
            <strong className="font-medium text-muted-foreground">Asset creator</strong>{' '}
            <a
              href={ExplorerLink.account(entryGatingAddress)}
              target="_blank"
              rel="noreferrer"
              className="mt-1 font-mono whitespace-nowrap hover:underline"
            >
              {ellipseAddressJsx(entryGatingAddress)}
            </a>
          </>
        )
      case GatingType.AssetId:
        return (
          <>
            <strong className="font-medium text-muted-foreground">Asset ID</strong>
            <ul className="mt-1 list-none list-inside">
              {entryGatingAssets
                .filter((assetId) => assetId !== 0)
                .map((assetId) => (
                  <li key={assetId}>
                    <a
                      href={ExplorerLink.asset(assetId)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono hover:underline"
                    >
                      {assetId}
                    </a>
                  </li>
                ))}
            </ul>
          </>
        )
      case GatingType.CreatorNfd:
        return (
          <>
            <strong className="font-medium text-muted-foreground">Asset creator</strong>{' '}
            <div>
              <NfdThumbnail nameOrId={entryGatingAssets[0]} link />
            </div>
          </>
        )
      case GatingType.SegmentNfd:
        return (
          <>
            <strong className="font-medium text-muted-foreground">Segment of</strong>{' '}
            <div className="flex">
              <NfdThumbnail nameOrId={entryGatingAssets[0]} link />
            </div>
          </>
        )
      default:
        return null
    }
  }

  const renderDialogContent = () => {
    if (!validator) {
      return (
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-left">Error</DialogTitle>
            <DialogDescription className="text-left">Missing validator data.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      )
    }

    const { entryGatingType, gatingAssetMinBalance } = validator.config

    if (isLoading) {
      return (
        <DialogContent>
          <div className="flex items-center justify-center my-8">
            <Loading size="lg" className="opacity-50" />
          </div>
        </DialogContent>
      )
    }

    if (accountInfoQuery.error) {
      return (
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-left">Error</DialogTitle>
            <DialogDescription className="text-left">
              {accountInfoQuery.error.message || 'Failed to fetch account information'}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      )
    }

    if (heldGatingAssetQuery.error) {
      return (
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-left">Error</DialogTitle>
            <DialogDescription className="text-left">
              {heldGatingAssetQuery.error.message || 'Failed to fetch gating assets'}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      )
    }

    if (!hasGatingAccess()) {
      return (
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-left">Gating Asset Required</DialogTitle>
            <DialogDescription className="text-left">
              You do not hold a qualified gating asset to stake with this validator
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm space-y-1 border-l-2 pl-4">
            {renderEntryGatingAsset()}

            {![GatingType.None, GatingType.SegmentNfd].includes(entryGatingType) && (
              <div className="pt-4">
                <strong className="font-medium text-muted-foreground">Minimum Balance:</strong>{' '}
                <span className="font-mono">{formatAmount(gatingAssetMinBalance.toString())}</span>
              </div>
            )}
          </div>
          <DialogFooter className="mt-4">
            <Button variant="secondary" size="sm" onClick={() => handleOpenChange(false)}>
              Close
            </Button>
            <Button size="sm" onClick={handleRefetchGatingAsset}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              Check again
            </Button>
          </DialogFooter>
        </DialogContent>
      )
    }

    return (
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-left">Add Stake to Validator {validator?.id}</DialogTitle>
          <DialogDescription className="text-left">
            This will add ALGO stake to{' '}
            {!targetPoolId ? (
              'one of the staking pools'
            ) : (
              <strong className="text-foreground font-semibold">Pool {targetPoolId}</strong>
            )}
          </DialogDescription>
        </DialogHeader>
        <div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <FormField
                control={form.control}
                name="amountToStake"
                render={({ field }) => (
                  <FormItem className="w-2/3">
                    <FormLabel>Amount to Stake</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          className="pr-16"
                          {...field}
                          onChange={(e) => {
                            field.onChange(e) // Inform react-hook-form of the change
                            debouncedFetchTargetPoolId(e.target.value) // Debounced target pool fetch
                          }}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="absolute inset-y-1 right-1.5 h-7 px-2 flex items-center text-muted-foreground text-xs uppercase"
                          onClick={handleSetMaxAmount}
                        >
                          Max
                        </Button>
                      </div>
                    </FormControl>
                    <FormDescription>
                      Available to stake:{' '}
                      <AlgoDisplayAmount
                        amount={stakerMaximumStake}
                        microalgos
                        mutedRemainder
                        className="font-mono"
                      />
                    </FormDescription>
                    <div className="h-5">
                      <FormMessage>{errors.amountToStake?.message}</FormMessage>
                    </div>
                  </FormItem>
                )}
              />

              {mbrRequired && stakerMbr && (
                <Alert className="mt-4">
                  <MessageCircleWarning className="h-5 w-5 -mt-1" />
                  <AlertTitle>Minimum balance requirement</AlertTitle>
                  <AlertDescription className="text-muted-foreground">
                    First time stakers must pay an additional{' '}
                    <AlgoDisplayAmount
                      amount={stakerMbr}
                      microalgos
                      className="font-mono text-foreground"
                    />{' '}
                    fee.
                  </AlertDescription>
                </Alert>
              )}

              <DialogFooter className="mt-4">
                <Button type="submit" disabled={isSigning || !isValid}>
                  Add Stake
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </div>
      </DialogContent>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {renderDialogContent()}
    </Dialog>
  )
}
