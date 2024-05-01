import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet-react'
import { RotateCcw } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { changeValidatorRewardInfo } from '@/api/contracts'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { EditValidatorModal } from '@/components/ValidatorDetails/EditValidatorModal'
import { Validator } from '@/interfaces/validator'

interface EditRewardPerPayoutProps {
  validator: Validator
}

export function EditRewardPerPayout({ validator }: EditRewardPerPayoutProps) {
  const [isOpen, setIsOpen] = React.useState<boolean>(false)
  const [isSigning, setIsSigning] = React.useState(false)

  const { transactionSigner, activeAddress } = useWallet()
  const queryClient = useQueryClient()
  const router = useRouter()

  const formSchema = z.object({
    rewardPerPayout: z
      .string()
      .refine((val) => val === '' || (!isNaN(Number(val)) && Number(val) > 0), {
        message: 'Invalid reward amount per payout',
      }),
  })

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      rewardPerPayout: String(validator.config.rewardPerPayout || ''),
    },
  })

  const { errors, isDirty } = form.formState

  const handleResetForm = () => {
    form.resetField('rewardPerPayout')
    form.clearErrors()
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setIsOpen(false)
      setTimeout(() => handleResetForm(), 500)
    } else {
      setIsOpen(true)
    }
  }

  const toastIdRef = React.useRef(`toast-${Date.now()}-${Math.random()}`)
  const TOAST_ID = toastIdRef.current

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const toastId = `${TOAST_ID}-validator`

    try {
      setIsSigning(true)

      if (!activeAddress) {
        throw new Error('No active address')
      }

      toast.loading('Sign transactions to update reward amount per payout...', { id: toastId })

      const { entryGatingType, entryGatingAddress, entryGatingAssets, gatingAssetMinBalance } =
        validator.config

      await changeValidatorRewardInfo(
        validator.id,
        entryGatingType,
        entryGatingAddress,
        entryGatingAssets,
        gatingAssetMinBalance,
        BigInt(values.rewardPerPayout),
        transactionSigner,
        activeAddress,
      )

      toast.success(`Reward amount per payout updated!`, {
        id: toastId,
        duration: 5000,
      })

      // Manually update ['validators'] query to avoid refetching
      queryClient.setQueryData<Validator[]>(['validators'], (prevData) => {
        if (!prevData) {
          return prevData
        }

        return prevData.map((validator: Validator) => {
          if (validator.id === validator!.id) {
            return {
              ...validator,
              config: {
                ...validator.config,
                rewardPerPayout: BigInt(values.rewardPerPayout),
              },
            }
          }

          return validator
        })
      })

      // Invalidate other queries to update UI
      queryClient.invalidateQueries({ queryKey: ['validator', String(validator.id)] })
      router.invalidate()
    } catch (error) {
      toast.error('Failed to update reward amount per payout', { id: toastId })
      console.error(error)
    } finally {
      setIsSigning(false)
      handleResetForm()
      setIsOpen(false)
    }
  }

  return (
    <EditValidatorModal
      title="Edit Reward Per Payout"
      description={`Set the amount of reward tokens paid out each epoch for Validator ${validator.id}`}
      open={isOpen}
      onOpenChange={handleOpenChange}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="">
          <div className="grid gap-4 py-4">
            <FormField
              control={form.control}
              name="rewardPerPayout"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount per payout</FormLabel>
                  <FormControl>
                    <Input placeholder="" {...field} />
                  </FormControl>
                  <FormMessage>{errors.rewardPerPayout?.message}</FormMessage>
                </FormItem>
              )}
            />
          </div>
          <DialogFooter className="mt-4 gap-y-2">
            <Button
              variant="outline"
              onClick={(e) => {
                e.preventDefault()
                handleResetForm()
              }}
              disabled={isSigning || !isDirty}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset
            </Button>
            <Button type="submit" disabled={isSigning || !isDirty}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </EditValidatorModal>
  )
}
