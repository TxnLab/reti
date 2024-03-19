import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { addStakingPool, fetchMbrAmounts, initStakingPoolStorage } from '@/api/contracts'
import { NodeSelect } from '@/components/NodeSelect'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { NodePoolAssignmentConfig, Validator } from '@/interfaces/validator'
import { findFirstAvailableNode } from '@/utils/contracts'
import { cn } from '@/utils/ui'

const formSchema = z.object({
  nodeNum: z.string(),
})

interface AddPoolModalProps {
  validator: Validator | null
  setValidator: React.Dispatch<React.SetStateAction<Validator | null>>
  poolAssignment: NodePoolAssignmentConfig
  disabled?: boolean
}

export function AddPoolModal({ validator, setValidator, poolAssignment }: AddPoolModalProps) {
  const [isSigning, setIsSigning] = React.useState<boolean>(false)

  const queryClient = useQueryClient()
  const router = useRouter()
  const { signer, activeAddress } = useWallet()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: {
      nodeNum: '1',
    },
  })

  const { isValid } = form.formState

  const defaultNodeNum = React.useMemo(() => {
    if (!validator?.poolsPerNode) return '1'

    const nodeNum = findFirstAvailableNode(poolAssignment, validator.poolsPerNode)
    return nodeNum?.toString() || '1'
  }, [poolAssignment, validator?.poolsPerNode])

  React.useEffect(() => {
    if (!validator) {
      return
    }
    form.setValue('nodeNum', defaultNodeNum)
  }, [defaultNodeNum, form, validator])

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setValidator(null)
      form.reset({ nodeNum: '1' })
    }
  }

  const toastIdRef = React.useRef(`toast-${Date.now()}-${Math.random()}`)
  const TOAST_ID = toastIdRef.current

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    const toastId = `${TOAST_ID}-add-pool`

    try {
      setIsSigning(true)

      if (!activeAddress) {
        throw new Error('No active address')
      }

      const { poolMbr, poolInitMbr } = await queryClient.ensureQueryData({
        queryKey: ['mbr'],
        queryFn: () => fetchMbrAmounts(),
      })

      toast.loading('Sign transactions to add staking pool...', { id: toastId })

      const stakingPool = await addStakingPool(
        validator!.id,
        Number(data.nodeNum),
        poolMbr,
        signer,
        activeAddress,
      )

      await initStakingPoolStorage(stakingPool.poolAppId, poolInitMbr, signer, activeAddress)

      toast.success(`Staking pool ${stakingPool.poolId} created!`, {
        id: toastId,
        duration: 5000,
      })

      queryClient.setQueryData<Validator>(['validator', String(validator!.id)], (prevData) => {
        if (!prevData) {
          return prevData
        }

        return {
          ...prevData,
          numPools: prevData.numPools + 1,
        }
      })

      queryClient.setQueryData<Validator[]>(['validators'], (prevData) => {
        if (!prevData) {
          return prevData
        }

        return prevData.map((validator: Validator) => {
          if (validator.id === validator!.id) {
            return {
              ...validator,
              numPools: validator.numPools + 1,
            }
          }

          return validator
        })
      })

      router.invalidate()
      queryClient.invalidateQueries({ queryKey: ['pool-assignments', validator!.id] })
    } catch (error) {
      toast.error('Failed to create staking pool', { id: toastId })
      console.error(error)
    } finally {
      setIsSigning(false)
      setValidator(null)
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
            <form onSubmit={form.handleSubmit(onSubmit)} className="w-2/3 space-y-6">
              <FormField
                control={form.control}
                name="nodeNum"
                render={({ field }) => (
                  <FormItem className={cn(poolAssignment === null ? 'hidden' : '')}>
                    <FormLabel>Select Node</FormLabel>
                    {poolAssignment && !!validator && (
                      <NodeSelect
                        nodes={poolAssignment}
                        poolsPerNode={validator.poolsPerNode}
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      />
                    )}
                    <FormDescription>
                      Select a node with an available slot (max: {validator?.poolsPerNode})
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={isSigning || !isValid}>
                Add Pool
              </Button>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
