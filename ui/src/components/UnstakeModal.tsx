import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet'
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

interface UnstakeModalProps {
  validator: Validator | null
  setValidator: React.Dispatch<React.SetStateAction<Validator | null>>
  stakesByValidator: StakerValidatorData[]
}

export function UnstakeModal({ validator, setValidator, stakesByValidator }: UnstakeModalProps) {
  const [isSigning, setIsSigning] = React.useState<boolean>(false)
  const [selectedPool, setSelectedPool] = React.useState<string>('')

  const poolData = React.useMemo<StakerPoolData[]>(
    () => stakesByValidator.find((data) => data.validatorId === validator?.id)?.pools || [],
    [stakesByValidator, validator],
  )

  React.useEffect(() => {
    if (poolData.length > 0 && selectedPool === '') {
      setSelectedPool(poolData[0].poolKey.poolAppId.toString())
    }
  }, [poolData])

  const queryClient = useQueryClient()
  const router = useRouter()
  const { signer, activeAddress } = useWallet()

  const formSchema = z.object({
    amountToUnstake: z
      .string()
      .refine((val) => val !== '', {
        message: 'Required field',
      })
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
        message: 'Invalid amount',
      })
      .superRefine((val, ctx) => {
        const algoAmount = parseFloat(val)
        const amount = AlgoAmount.Algos(algoAmount).microAlgos
        const maximumAmount =
          poolData.find((p) => p.poolKey.poolAppId.toString() === selectedPool)?.balance || 0

        if (amount > maximumAmount) {
          ctx.addIssue({
            code: z.ZodIssueCode.too_big,
            maximum: maximumAmount,
            type: 'number',
            inclusive: true,
            message: 'Amount to unstake cannot exceed pool balance',
          })
        }
      }),
  })

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      amountToUnstake: '',
    },
  })

  const { errors, isValid } = form.formState

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setValidator(null)
      setSelectedPool('')
      form.reset()
    }
  }

  const handleSetMaxAmount = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()

    const pool = poolData.find((p) => p.poolKey.poolAppId.toString() === selectedPool)

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

      const pool = poolData.find((p) => p.poolKey.poolAppId.toString() === selectedPool)

      if (!pool) {
        throw new Error('Invalid pool')
      }

      const amountToUnstake = AlgoAmount.Algos(parseFloat(data.amountToUnstake)).microAlgos

      toast.loading('Sign transactions to remove stake...', { id: toastId })

      await removeStake(pool.poolKey.poolAppId, amountToUnstake, signer, activeAddress)

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
            ['validator', { validatorId: pool.poolKey.validatorId.toString() }],
            (prevData) => {
              if (!prevData) {
                return prevData
              }

              return {
                ...prevData,
                numStakers: allStakeRemoved ? prevData.numStakers - 1 : prevData.numStakers,
                totalStaked: prevData.totalStaked - amountToUnstake,
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
                  numStakers: allStakeRemoved ? v.numStakers - 1 : v.numStakers,
                  totalStaked: v.totalStaked - amountToUnstake,
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
            This will remove your ALGO stake from the pool specified.
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
                  {poolData.length === 1 ? (
                    <p className="py-2 text-sm">
                      <span className="inline-flex items-center">
                        <AlgoDisplayAmount amount={poolData[0].balance} microalgos />
                      </span>
                    </p>
                  ) : (
                    <>
                      <Select onValueChange={setSelectedPool} value={selectedPool}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a verified email to display" />
                        </SelectTrigger>
                        <SelectContent>
                          {poolData
                            .sort((a, b) => (a.poolKey.poolAppId > b.poolKey.poolAppId ? 1 : -1))
                            .map((pool) => (
                              <SelectItem
                                key={pool.poolKey.poolAppId}
                                value={pool.poolKey.poolAppId.toString()}
                              >
                                <span className="inline-flex items-center gap-x-2">
                                  <span className="font-mono">{pool.poolKey.poolId}</span>
                                  <span className="text-muted-foreground">-</span>
                                  <AlgoDisplayAmount amount={pool.balance} microalgos />
                                </span>
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[0.8rem] text-muted-foreground">Select pool</p>
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
                        <FormDescription>Enter the amount you wish to unstake.</FormDescription>
                        <FormMessage>{errors.amountToUnstake?.message}</FormMessage>
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
