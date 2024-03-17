import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { getAccountBalance } from '@/api/algod'
import {
  addStake,
  doesStakerNeedToPayMbr,
  isNewStakerToValidator,
  mbrQueryOptions,
} from '@/api/contracts'
import { AlgoDisplayAmount } from '@/components/AlgoDisplayAmount'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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

interface AddStakeModalProps {
  validator: Validator
  disabled?: boolean
}

export function AddStakeModal({ validator, disabled }: AddStakeModalProps) {
  const [isOpen, setIsOpen] = React.useState<boolean>(false)

  const queryClient = useQueryClient()
  const router = useRouter()
  const { signer, activeAddress } = useWallet()

  const { data: availableBalance } = useQuery({
    queryKey: ['available-balance', activeAddress],
    queryFn: () => getAccountBalance(activeAddress!),
    enabled: !!activeAddress,
    refetchInterval: 30000,
  })

  // @todo: check whether existing pool(s) have enough room for stakeAmount (set maximumAmount)
  const formSchema = z.object({
    amountToStake: z.string().superRefine((val, ctx) => {
      const amount = AlgoAmount.Algos(Number(val)).microAlgos
      const minimumAmount = validator.minStake
      const maximumAmount = availableBalance || 0

      if (amount < minimumAmount) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_small,
          minimum: minimumAmount,
          type: 'number',
          inclusive: true,
          message: 'Amount to stake must meet the minimum required',
        })
      }

      if (amount > maximumAmount) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_big,
          maximum: maximumAmount,
          type: 'number',
          inclusive: true,
          message: 'Amount to stake must not exceed available balance',
        })
      }
    }),
  })

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      amountToStake: '',
    },
  })

  const { errors } = form.formState

  const mbrQuery = useQuery(mbrQueryOptions)
  const stakerMbr = mbrQuery.data?.stakerMbr

  const toastIdRef = React.useRef(`toast-${Date.now()}-${Math.random()}`)
  const TOAST_ID = toastIdRef.current

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    const toastId = `${TOAST_ID}-add-stake`

    try {
      setIsOpen(false)

      if (!activeAddress) {
        throw new Error('No wallet connected')
      }

      const amountToStake = AlgoAmount.Algos(Number(data.amountToStake)).microAlgos

      const { stakerMbr } = await queryClient.ensureQueryData(mbrQueryOptions)
      const isMbrRequired = await doesStakerNeedToPayMbr(activeAddress)
      const totalAmount = isMbrRequired ? amountToStake + stakerMbr : amountToStake

      const isNewStaker = await isNewStakerToValidator(
        validator.id,
        activeAddress,
        validator.minStake,
      )

      toast.loading('Sign transactions to add stake...', { id: toastId })

      const poolKey = await addStake(validator.id, totalAmount, signer, activeAddress)

      toast.success(`Stake added to pool ${poolKey.poolId}!`, {
        id: toastId,
        duration: 5000,
      })

      queryClient.setQueryData<StakerValidatorData[]>(
        ['stakes', { staker: activeAddress }],
        (prevData) => {
          if (!prevData) {
            return prevData
          }

          const poolData: StakerPoolData = {
            poolKey,
            account: activeAddress,
            balance: totalAmount,
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
                    balance: data.balance + totalAmount,
                    pools: data.pools.map((pool) => {
                      if (pool.poolKey.poolId === poolKey.poolId) {
                        return {
                          ...pool,
                          balance: pool.balance + totalAmount,
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
                  balance: data.balance + totalAmount,
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
              balance: totalAmount,
              totalRewarded: 0,
              rewardTokenBalance: 0,
              entryTime: dayjs().unix(),
              pools: [poolData],
            },
          ]
        },
      )

      queryClient.setQueryData<Validator>(
        ['validator', { validatorId: validator.id.toString() }],
        (prevData) => {
          if (!prevData) {
            return prevData
          }

          return {
            ...prevData,
            numStakers: isNewStaker ? prevData.numStakers + 1 : prevData.numStakers,
            totalStaked: prevData.totalStaked + totalAmount,
          }
        },
      )

      queryClient.setQueryData<Validator[]>(['validators'], (prevData) => {
        if (!prevData) {
          return prevData
        }

        return prevData.map((v: Validator) => {
          if (v.id === validator.id) {
            return {
              ...v,
              numStakers: isNewStaker ? v.numStakers + 1 : v.numStakers,
              totalStaked: v.totalStaked + totalAmount,
            }
          }

          return v
        })
      })

      router.invalidate()
    } catch (error) {
      toast.error('Failed to add stake to pool', { id: toastId })
      console.error(error)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          Stake
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Stake to Validator {validator.id}</DialogTitle>
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
                      <Input {...field} />
                    </FormControl>
                    <FormDescription>
                      Enter the amount you wish to stake.{' '}
                      {stakerMbr && (
                        <span>
                          NOTE: First time stakers will need to pay{' '}
                          <AlgoDisplayAmount amount={stakerMbr} microalgos /> in fees.
                        </span>
                      )}
                    </FormDescription>
                    <FormMessage>{errors.amountToStake?.message}</FormMessage>
                  </FormItem>
                )}
              />
              <Button type="submit">Submit</Button>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
