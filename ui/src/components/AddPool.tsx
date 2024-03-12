import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet'
import { Pencil } from 'lucide-react'
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
  DialogTrigger,
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

interface AddPoolProps {
  validatorId: string
  nodePoolAssignment: NodePoolAssignmentConfig
  maxPoolsPerNode: number
  disabled?: boolean
}

export function AddPool({
  validatorId,
  nodePoolAssignment,
  maxPoolsPerNode,
  disabled = false,
}: AddPoolProps) {
  const [isOpen, setIsOpen] = React.useState<boolean>(false)

  const queryClient = useQueryClient()
  const router = useRouter()
  const { signer, activeAddress } = useWallet()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nodeNum: findFirstAvailableNode(nodePoolAssignment, maxPoolsPerNode)?.toString() || '1',
    },
  })

  const toastIdRef = React.useRef(`toast-${Date.now()}-${Math.random()}`)
  const TOAST_ID = toastIdRef.current

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    const toastId = `${TOAST_ID}-add-pool`

    try {
      setIsOpen(false)

      if (!activeAddress) {
        throw new Error('No wallet connected')
      }

      const { poolMbr, poolInitMbr } = await queryClient.ensureQueryData({
        queryKey: ['mbr'],
        queryFn: () => fetchMbrAmounts(),
      })

      toast.loading('Sign transactions to add staking pool...', { id: toastId })

      const stakingPool = await addStakingPool(
        Number(validatorId),
        Number(data.nodeNum),
        poolMbr,
        signer,
        activeAddress,
      )

      toast.success(`Staking pool ${stakingPool.id} created!`, {
        id: toastId,
        duration: 5000,
      })

      toast.loading('Sign transactions to fund staking pool MBR...', { id: toastId })

      await initStakingPoolStorage(stakingPool.appId, poolInitMbr, signer, activeAddress)

      toast.success(`Staking pool ${stakingPool.id} created!`, {
        id: toastId,
        duration: 5000,
      })

      queryClient.setQueryData<Validator>(['validator', { validatorId }], (prevData) => {
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
          if (validator.id === Number(validatorId)) {
            return {
              ...validator,
              numPools: validator.numPools + 1,
            }
          }

          return validator
        })
      })

      router.invalidate()
      queryClient.invalidateQueries({ queryKey: ['nodePoolAssignment', Number(validatorId)] })
    } catch (error) {
      toast.error('Failed to create staking pool', { id: toastId })
      console.error(error)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="-my-2" disabled={disabled}>
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent onCloseAutoFocus={(event: Event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Add a Pool</DialogTitle>
          <DialogDescription>
            Create and fund a new staking pool for Validator {validatorId}
          </DialogDescription>
        </DialogHeader>
        <div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="w-2/3 space-y-6">
              <FormField
                control={form.control}
                name="nodeNum"
                render={({ field }) => (
                  <FormItem className={cn(nodePoolAssignment === null ? 'hidden' : '')}>
                    <FormLabel>Select Node</FormLabel>
                    {nodePoolAssignment && (
                      <NodeSelect
                        nodes={nodePoolAssignment}
                        maxPoolsPerNode={maxPoolsPerNode}
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      />
                    )}
                    <FormDescription>
                      Select a node with an available slot (max: {maxPoolsPerNode})
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit">Add Pool</Button>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
