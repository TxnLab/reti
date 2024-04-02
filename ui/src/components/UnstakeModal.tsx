import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet-react'
import { ArrowDownLeft } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { removeStake } from '@/api/contracts'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StakerPoolData, StakerValidatorData } from '@/interfaces/staking'
import { Validator } from '@/interfaces/validator'
import { formatAlgoAmount } from '@/utils/format'

interface UnstakeModalProps {
  validator: Validator | null
  setValidator: React.Dispatch<React.SetStateAction<Validator | null>>
  stakesByValidator: StakerValidatorData[]
}

export function UnstakeModal({ validator, setValidator, stakesByValidator }: UnstakeModalProps) {
  const [isSigning, setIsSigning] = React.useState<boolean>(false)
  const [selectedPoolId, setSelectedPoolId] = React.useState<string>('')

  const stakerPoolsData = React.useMemo<StakerPoolData[]>(
    () => stakesByValidator.find((data) => data.validatorId === validator?.id)?.pools || [],
    [stakesByValidator, validator],
  )

  React.useEffect(() => {
    if (stakerPoolsData.length > 0 && selectedPoolId === '') {
      setSelectedPoolId(stakerPoolsData[0].poolKey.poolId.toString())
    }
  }, [stakerPoolsData])

  const queryClient = useQueryClient()
  const router = useRouter()
  const { transactionSigner, activeAddress } = useWallet()

  const formSchema = z.object({
    amountToUnstake: z
      .string()
      .refine((val) => val !== '', {
        message: 'Required field',
      })
      .refine((val) => !isNaN(Number(val)) && parseFloat(val) > 0, {
        message: 'Invalid amount',
      })
      .superRefine((val, ctx) => {
        const algoAmount = parseFloat(val)
        const amountToUnstake = AlgoAmount.Algos(algoAmount).microAlgos
        const stakerPoolData = stakerPoolsData.find(
          (p) => p.poolKey.poolId === Number(selectedPoolId),
        )

        if (stakerPoolData && validator) {
          const currentBalance = stakerPoolData.balance
          const minimumStake = Number(validator.config.minEntryStake)

          if (amountToUnstake > currentBalance) {
            ctx.addIssue({
              code: z.ZodIssueCode.too_big,
              maximum: currentBalance,
              type: 'number',
              inclusive: true,
              message: 'Cannot exceed current stake',
            })
          }

          if (amountToUnstake !== currentBalance) {
            // Not removing all stake in pool, must maintain minimum stake
            if (currentBalance - amountToUnstake < minimumStake) {
              ctx.addIssue({
                code: z.ZodIssueCode.too_big,
                maximum: currentBalance - minimumStake,
                type: 'number',
                inclusive: true,
                message: `Minimum stake is ${formatAlgoAmount(AlgoAmount.MicroAlgos(minimumStake).algos)} ALGO`,
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
      amountToUnstake: '',
    },
  })

  const { errors, isValid } = form.formState

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setValidator(null)
      setSelectedPoolId('')
      form.reset()
    }
  }

  const handleSetSelectedPool = (poolId: string) => {
    setSelectedPoolId(poolId)
    form.reset()
  }

  const handleSetMaxAmount = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()

    const pool = stakerPoolsData.find((p) => p.poolKey.poolId === Number(selectedPoolId))

    if (!pool) {
      return
    }

    form.setValue('amountToUnstake', AlgoAmount.MicroAlgos(pool.balance).algos.toString(), {
      shouldValidate: true,
    })
  }

  const toastIdRef = React.useRef(`toast-${Date.now()}-${Math.random()}`)
  const TOAST_ID = toastIdRef.current

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    const toastId = `${TOAST_ID}-unstake`

    try {
      setIsSigning(true)

      if (!activeAddress) {
        throw new Error('No active address')
      }

      const pool = stakerPoolsData.find((p) => p.poolKey.poolId === Number(selectedPoolId))

      if (!pool) {
        throw new Error('Invalid pool')
      }

      const amountToUnstake = AlgoAmount.Algos(parseFloat(data.amountToUnstake)).microAlgos

      toast.loading('Sign transactions to remove stake...', { id: toastId })

      await removeStake(pool.poolKey.poolAppId, amountToUnstake, transactionSigner, activeAddress)

      toast.success(
        <div className="flex items-center gap-x-2">
          <ArrowDownLeft className="h-5 w-5 text-foreground" />
          <span>
            Removed <AlgoDisplayAmount amount={amountToUnstake} microalgos className="font-bold" />{' '}
            from Pool {pool.poolKey.poolId} on Validator {pool.poolKey.validatorId}
          </span>
        </div>,
        {
          id: toastId,
          duration: 5000,
        },
      )

      const allStakerData = queryClient.getQueryData<StakerValidatorData[]>([
        'stakes',
        { staker: activeAddress },
      ])

      const stakerValidatorData = allStakerData?.find(
        (data) => data.validatorId === pool.poolKey.validatorId,
      )

      if (stakerValidatorData) {
        const updatedPool = stakerValidatorData.pools.find(
          (p) => p.poolKey.poolId === pool.poolKey.poolId,
        )

        if (updatedPool) {
          const newBalance = updatedPool.balance - amountToUnstake

          const newPools =
            newBalance === 0
              ? stakerValidatorData.pools.filter((p) => p.poolKey.poolId !== pool.poolKey.poolId)
              : stakerValidatorData.pools.map((p) => {
                  if (p.poolKey.poolId === pool.poolKey.poolId) {
                    return {
                      ...p,
                      balance: newBalance,
                    }
                  }

                  return p
                })

          const allStakeRemoved = newPools.length === 0

          queryClient.setQueryData<StakerValidatorData[]>(
            ['stakes', { staker: activeAddress }],
            (prevData) => {
              if (!prevData) {
                return prevData
              }

              if (allStakeRemoved) {
                return prevData.filter((d) => d.validatorId !== pool.poolKey.validatorId)
              }

              return prevData.map((data) => {
                if (data.validatorId === pool.poolKey.validatorId) {
                  return {
                    ...data,
                    balance: data.balance - amountToUnstake,
                    pools: newPools,
                  }
                }

                return data
              })
            },
          )

          queryClient.setQueryData<Validator>(
            ['validator', String(pool.poolKey.validatorId)],
            (prevData) => {
              if (!prevData) {
                return prevData
              }

              return {
                ...prevData,
                state: {
                  ...prevData.state,
                  totalStakers: allStakeRemoved
                    ? prevData.state.totalStakers - 1
                    : prevData.state.totalStakers,
                  totalAlgoStaked: prevData.state.totalAlgoStaked - BigInt(amountToUnstake),
                },
              }
            },
          )

          queryClient.setQueryData<Validator[]>(['validators'], (prevData) => {
            if (!prevData) {
              return prevData
            }

            return prevData.map((v: Validator) => {
              if (v.id === pool.poolKey.validatorId) {
                return {
                  ...v,
                  state: {
                    ...v.state,
                    totalStakers: allStakeRemoved ? v.state.totalStakers - 1 : v.state.totalStakers,
                    totalAlgoStaked: v.state.totalAlgoStaked - BigInt(amountToUnstake),
                  },
                }
              }

              return v
            })
          })
        }
      }

      router.invalidate()
    } catch (error) {
      toast.error('Failed to remove stake from pool', { id: toastId })
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
          <DialogTitle>Remove Stake from Validator {validator?.id}</DialogTitle>
          <DialogDescription>
            This will remove your ALGO stake from{' '}
            {stakerPoolsData.length === 1
              ? `Pool ${stakerPoolsData[0].poolKey.poolId}`
              : 'the selected pool'}
          </DialogDescription>
        </DialogHeader>
        <div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="flex gap-x-4 w-full">
                <div className="w-2/5 space-y-2">
                  <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    Current Stake
                  </label>
                  {stakerPoolsData.length === 1 ? (
                    <p className="py-2 text-sm">
                      <span className="inline-flex items-center">
                        <AlgoDisplayAmount
                          amount={stakerPoolsData[0].balance}
                          microalgos
                          mutedRemainder
                        />
                      </span>
                    </p>
                  ) : (
                    <>
                      <Select onValueChange={handleSetSelectedPool} value={selectedPoolId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a verified email to display" />
                        </SelectTrigger>
                        <SelectContent>
                          {stakerPoolsData
                            .sort((a, b) => (a.poolKey.poolAppId > b.poolKey.poolAppId ? 1 : -1))
                            .map((pool) => (
                              <SelectItem
                                key={pool.poolKey.poolId}
                                value={pool.poolKey.poolId.toString()}
                              >
                                <span className="inline-flex items-center gap-x-2">
                                  <span className="font-mono">{pool.poolKey.poolId}</span>
                                  <span className="text-muted-foreground">-</span>
                                  <AlgoDisplayAmount
                                    amount={pool.balance}
                                    microalgos
                                    mutedRemainder
                                  />
                                </span>
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[0.8rem] text-muted-foreground">Select a pool</p>
                    </>
                  )}
                </div>
                <div className="flex-1">
                  <FormField
                    control={form.control}
                    name="amountToUnstake"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Amount to Unstake</FormLabel>
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
                        <FormDescription>Enter the amount to unstake</FormDescription>
                        <div className="h-5">
                          <FormMessage>{errors.amountToUnstake?.message}</FormMessage>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <Button type="submit" disabled={isSigning || !isValid}>
                Unstake
              </Button>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
