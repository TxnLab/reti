import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ProgressBar } from '@tremor/react'
import { useWallet } from '@txnlab/use-wallet-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { addStakingPool, fetchValidator, initStakingPoolStorage } from '@/api/contracts'
import { mbrQueryOptions, poolAssignmentQueryOptions } from '@/api/queries'
import { AlgoDisplayAmount } from '@/components/AlgoDisplayAmount'
import { NodeSelect } from '@/components/NodeSelect'
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { NodePoolAssignmentConfig, Validator, ValidatorPoolKey } from '@/interfaces/validator'
import { findFirstAvailableNode, setValidatorQueriesData } from '@/utils/contracts'
import { cn } from '@/utils/ui'

const formSchema = z.object({
  nodeNum: z.string(),
})

interface AddPoolModalProps {
  validator: Validator | null
  setValidator: React.Dispatch<React.SetStateAction<Validator | null>>
  poolAssignment?: NodePoolAssignmentConfig
}

export function AddPoolModal({
  validator,
  setValidator,
  poolAssignment: poolAssignmentProp,
}: AddPoolModalProps) {
  const [isSigning, setIsSigning] = React.useState<boolean>(false)
  const [progress, setProgress] = React.useState<number>(0)
  const [currentStep, setCurrentStep] = React.useState<number>(1)
  const [poolKey, setPoolKey] = React.useState<ValidatorPoolKey | null>(null)

  const queryClient = useQueryClient()
  const { transactionSigner, activeAddress } = useWallet()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: {
      nodeNum: '1',
    },
  })

  const { isValid } = form.formState

  const mbrQuery = useQuery(mbrQueryOptions)
  const { poolMbr = 0, poolInitMbr = 0 } = mbrQuery.data || {}

  const assignmentQuery = useQuery(poolAssignmentQueryOptions(validator?.id || '', !!validator))
  const poolAssignment = assignmentQuery.data || poolAssignmentProp

  const defaultNodeNum = React.useMemo(() => {
    if (!validator?.config.poolsPerNode || !poolAssignment) {
      return '1'
    }
    const nodeNum = findFirstAvailableNode(poolAssignment, validator.config.poolsPerNode)
    return nodeNum?.toString() || '1'
  }, [poolAssignment, validator?.config.poolsPerNode])

  React.useEffect(() => {
    form.setValue('nodeNum', defaultNodeNum)
  }, [defaultNodeNum, form.setValue])

  const handleResetForm = () => {
    form.reset({ nodeNum: '1' })
    form.clearErrors()
    setProgress(0)
    setCurrentStep(1)
    setPoolKey(null)
    setIsSigning(false)
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      if (validator) setValidator(null)
      setTimeout(() => handleResetForm(), 500)
    } else {
      handleResetForm()
    }
  }

  const toastIdRef = React.useRef(`toast-${Date.now()}-${Math.random()}`)
  const TOAST_ID = toastIdRef.current

  const handleCreatePool = async (data: z.infer<typeof formSchema>) => {
    const toastId = `${TOAST_ID}-add-pool`

    try {
      setIsSigning(true)

      if (!activeAddress) {
        throw new Error('No active address')
      }

      if (!poolMbr) {
        throw new Error('No MBR data found')
      }

      toast.loading('Sign transactions to add staking pool...', { id: toastId })

      const stakingPoolKey = await addStakingPool(
        validator!.id,
        Number(data.nodeNum),
        poolMbr,
        transactionSigner,
        activeAddress,
      )

      setPoolKey(stakingPoolKey)

      toast.success(`Staking pool ${stakingPoolKey.poolId} created!`, {
        id: toastId,
        duration: 5000,
      })
      setProgress(50)
      setCurrentStep(2)
    } catch (error) {
      toast.error('Failed to create staking pool', { id: toastId })
      console.error(error)
      handleOpenChange(false)
    } finally {
      setIsSigning(false)
    }
  }

  const handlePayPoolMbr = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()

    const toastId = `${TOAST_ID}-pay-mbr`

    try {
      setIsSigning(true)

      if (!activeAddress) {
        throw new Error('No active address')
      }

      if (!poolKey) {
        throw new Error('No pool found')
      }

      if (!poolInitMbr) {
        throw new Error('No MBR data found')
      }

      toast.loading(`Sign transaction to pay MBR for pool ${poolKey.poolId}...`, {
        id: toastId,
      })

      const optInRewardToken =
        validator?.config.rewardTokenId !== 0 && validator?.state.numPools === 0

      await initStakingPoolStorage(
        poolKey.poolAppId,
        poolInitMbr,
        optInRewardToken,
        transactionSigner,
        activeAddress,
      )

      toast.success(`Pool ${poolKey.poolId} MBR paid successfully!`, {
        id: toastId,
        duration: 5000,
      })
      setProgress(100)

      // Refetch validator data
      const newData = await fetchValidator(validator!.id)
      setValidatorQueriesData(queryClient, newData)

      setTimeout(() => handleOpenChange(false), 1000)
    } catch (error) {
      toast.error('Failed to pay MBR', { id: toastId })
      console.error(error)
      setIsSigning(false)
    }
  }

  return (
    <Dialog open={!!validator} onOpenChange={handleOpenChange}>
      <DialogContent onCloseAutoFocus={(event: Event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Add a Pool</DialogTitle>
          <DialogDescription>
            Create and fund a new staking pool for Validator {validator?.id}
          </DialogDescription>
        </DialogHeader>
        <div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleCreatePool)}>
              <FormField
                control={form.control}
                name="nodeNum"
                render={({ field }) => (
                  <FormItem
                    className={cn(
                      currentStep == 2 || !poolAssignment || !validator ? 'hidden' : '',
                    )}
                  >
                    <FormLabel>Select Node</FormLabel>
                    {poolAssignment && !!validator && (
                      <NodeSelect
                        nodes={poolAssignment}
                        poolsPerNode={validator.config.poolsPerNode}
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      />
                    )}
                    <FormDescription>
                      Select a node with an available slot (max: {validator?.config.poolsPerNode})
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {currentStep == 2 && (
                <div className="space-y-2">
                  <FormLabel>Pay Minimum Required Balance</FormLabel>
                  <p className="text-sm text-muted-foreground">
                    To initialize the staking pool, a{' '}
                    <AlgoDisplayAmount
                      amount={poolInitMbr}
                      microalgos
                      className="text-foreground font-mono"
                    />{' '}
                    MBR payment is required.
                  </p>
                </div>
              )}
              <DialogFooter className="my-6 sm:justify-start">
                {currentStep === 1 && (
                  <Button type="submit" disabled={isSigning || !isValid}>
                    Create Pool (1/2)
                  </Button>
                )}
                {currentStep === 2 && (
                  <Button onClick={handlePayPoolMbr}>Pay Pool MBR (2/2)</Button>
                )}
              </DialogFooter>

              <div className={cn('my-4')}>
                <ProgressBar value={progress} color="rose" className="mt-3" showAnimation />
              </div>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
