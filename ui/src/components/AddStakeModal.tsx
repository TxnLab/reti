import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet'
import { ArrowUpRight } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { getAccountBalance } from '@/api/algod'
import {
  addStake,
  doesStakerNeedToPayMbr,
  fetchMaxAvailableToStake,
  isNewStakerToValidator,
} from '@/api/contracts'
import { mbrQueryOptions } from '@/api/queries'
import { AlgoDisplayAmount } from '@/components/AlgoDisplayAmount'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { StakerPoolData, StakerValidatorData } from '@/interfaces/staking'
import { Validator } from '@/interfaces/validator'
import { dayjs } from '@/utils/dayjs'
import { formatAlgoAmount } from '@/utils/format'

interface AddStakeModalProps {
  validator: Validator | null
  setValidator: React.Dispatch<React.SetStateAction<Validator | null>>
}

export function AddStakeModal({ validator, setValidator }: AddStakeModalProps) {
  const [isSigning, setIsSigning] = React.useState<boolean>(false)

  const queryClient = useQueryClient()
  const router = useRouter()
  const { signer, activeAddress } = useWallet()

  // @todo: this will be available globally from wallet menu
  const availableBalanceQuery = useQuery({
    queryKey: ['available-balance', activeAddress],
    queryFn: () => getAccountBalance(activeAddress!, true),
    enabled: !!activeAddress,
    refetchInterval: 30000,
  })
  const availableBalance = availableBalanceQuery.data || 0

  // @todo: make this a custom hook, call from higher up and pass down as prop
  const mbrQuery = useQuery(mbrQueryOptions)
  const stakerMbr = mbrQuery.data?.stakerMbr || 0

  // @todo: make this a custom hook, call from higher up and pass down as prop
  const mbrRequiredQuery = useQuery({
    queryKey: ['mbr-required', activeAddress],
    queryFn: () => doesStakerNeedToPayMbr(activeAddress!),
    enabled: !!activeAddress,
    staleTime: Infinity,
  })
  const mbrRequired = mbrRequiredQuery.data || false
  const mbrAmount = mbrRequired ? stakerMbr : 0

  const poolMaximumQuery = useQuery({
    queryKey: ['pool-max', validator?.id],
    queryFn: () => fetchMaxAvailableToStake(validator!.id),
    enabled: !!validator,
  })
  const poolMaximumStake = poolMaximumQuery.data

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
      .superRefine((val, ctx) => {
        const algoAmount = parseFloat(val)
        const amountToStake = AlgoAmount.Algos(algoAmount).microAlgos

        if (validator) {
          const minimumStake = Number(validator.config.minEntryStake)

          if (amountToStake < minimumStake) {
            ctx.addIssue({
              code: z.ZodIssueCode.too_small,
              minimum: minimumStake,
              type: 'number',
              inclusive: true,
              message: `Minimum stake is ${formatAlgoAmount(AlgoAmount.MicroAlgos(minimumStake).algos)} ALGO`,
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

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setValidator(null)
      form.reset()
    }
  }

  const handleSetMaxAmount = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()

    form.setValue('amountToStake', AlgoAmount.MicroAlgos(maximumStake).algos.toString(), {
      shouldValidate: true,
    })
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

      const amountToStake = AlgoAmount.Algos(Number(data.amountToStake)).microAlgos
      const totalAmount = mbrRequired ? amountToStake + stakerMbr : amountToStake

      const isNewStaker = await isNewStakerToValidator(
        validator!.id,
        activeAddress,
        Number(validator!.config.minEntryStake),
      )

      toast.loading('Sign transactions to add stake...', { id: toastId })

      const poolKey = await addStake(validator!.id, totalAmount, signer, activeAddress)

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

      queryClient.setQueryData<StakerValidatorData[]>(
        ['stakes', { staker: activeAddress }],
        (prevData) => {
          if (!prevData) {
            return prevData
          }

          const poolData: StakerPoolData = {
            poolKey,
            account: activeAddress,
            balance: amountToStake,
            totalRewarded: 0,
            rewardTokenBalance: 0,
            entryTime: dayjs().unix(),
          }

          // Check if the staker already has a stake with the validator
          const existingValidatorData = prevData.find(
            (data) => data.validatorId === poolKey.validatorId,
          )

          if (existingValidatorData) {
            // Check if the staker already has a stake in the pool
            const existingPool = existingValidatorData.pools.find(
              (pool) => pool.poolKey.poolId === poolKey.poolId,
            )

            if (existingPool) {
              // Update the existing pool
              return prevData.map((data) => {
                if (data.validatorId === poolKey.validatorId) {
                  return {
                    ...data,
                    balance: data.balance + amountToStake,
                    pools: data.pools.map((pool) => {
                      if (pool.poolKey.poolId === poolKey.poolId) {
                        return {
                          ...pool,
                          balance: pool.balance + amountToStake,
                        }
                      }

                      return pool
                    }),
                  }
                }

                return data
              })
            }

            // Add the new pool to the existing validator stake data
            return prevData.map((data) => {
              if (data.validatorId === poolKey.validatorId) {
                return {
                  ...data,
                  balance: data.balance + amountToStake,
                  pools: [...data.pools, poolData],
                }
              }

              return data
            })
          }

          // Add a new validator stake entry
          return [
            ...prevData,
            {
              validatorId: poolKey.validatorId,
              balance: amountToStake,
              totalRewarded: 0,
              rewardTokenBalance: 0,
              entryTime: dayjs().unix(),
              pools: [poolData],
            },
          ]
        },
      )

      queryClient.setQueryData<Validator>(['validator', String(validator!.id)], (prevData) => {
        if (!prevData) {
          return prevData
        }

        return {
          ...prevData,
          state: {
            ...prevData.state,
            totalStakers: isNewStaker
              ? prevData.state.totalStakers + 1
              : prevData.state.totalStakers,
            totalAlgoStaked: prevData.state.totalAlgoStaked + BigInt(amountToStake),
          },
        }
      })

      queryClient.setQueryData<Validator[]>(['validators'], (prevData) => {
        if (!prevData) {
          return prevData
        }

        return prevData.map((v: Validator) => {
          if (v.id === validator!.id) {
            return {
              ...v,
              state: {
                ...v.state,
                totalStakers: isNewStaker ? v.state.totalStakers + 1 : v.state.totalStakers,
                totalAlgoStaked: v.state.totalAlgoStaked + BigInt(amountToStake),
              },
            }
          }

          return v
        })
      })

      router.invalidate()
    } catch (error) {
      toast.error('Failed to add stake to pool', { id: toastId })
      console.error(error)
    } finally {
      setIsSigning(false)
      setValidator(null)
    }
  }

  return (
    <Dialog open={!!validator} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Stake to Validator {validator?.id}</DialogTitle>
          <DialogDescription>
            This will send your ALGO to the validator and stake it in one of their pools.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="w-2/3 space-y-6">
              <FormField
                control={form.control}
                name="amountToStake"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount to Stake</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input className="pr-16" {...field} />
                        <Button
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
                      Enter the amount you wish to stake.{' '}
                      {mbrRequired && stakerMbr && (
                        <span>
                          NOTE: First time stakers will need to pay{' '}
                          <AlgoDisplayAmount amount={stakerMbr} microalgos /> in fees.
                        </span>
                      )}
                    </FormDescription>
                    <div className="h-5">
                      <FormMessage>{errors.amountToStake?.message}</FormMessage>
                    </div>
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={isSigning || !isValid}>
                Submit
              </Button>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
