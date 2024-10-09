import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@txnlab/use-wallet-react'
import { RotateCcw } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { changeValidatorRewardInfo, fetchValidator } from '@/api/contracts'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
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
import { EditValidatorModal } from '@/components/ValidatorDetails/EditValidatorModal'
import { Validator } from '@/interfaces/validator'
import { setValidatorQueriesData } from '@/utils/contracts'
import { convertFromBaseUnits, convertToBaseUnits } from '@/utils/format'
import { validatorSchemas } from '@/utils/validation'

interface EditRewardPerPayoutProps {
  validator: Validator
}

export function EditRewardPerPayout({ validator }: EditRewardPerPayoutProps) {
  const [isOpen, setIsOpen] = React.useState<boolean>(false)
  const [isSigning, setIsSigning] = React.useState(false)

  const { transactionSigner, activeAddress } = useWallet()
  const queryClient = useQueryClient()

  const formSchema = z.object({
    rewardPerPayout: validatorSchemas.rewardPerPayout(),
  })

  const {
    entryGatingType,
    entryGatingAddress,
    entryGatingAssets,
    gatingAssetMinBalance,
    rewardPerPayout,
  } = validator.config

  const tokenUnitName = validator.rewardToken?.params['unit-name']
  const tokenDecimals = validator.rewardToken?.params.decimals

  const rewardPerPayoutWholeUnits = convertFromBaseUnits(rewardPerPayout, tokenDecimals)

  const defaultValues = {
    rewardPerPayout: String(rewardPerPayoutWholeUnits || ''),
  }

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues,
  })

  const { errors, isDirty } = form.formState

  const handleResetForm = () => {
    form.reset(defaultValues)
    form.clearErrors()
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setIsOpen(false)
      setTimeout(() => handleResetForm(), 500)
    } else {
      setIsOpen(true)
      handleResetForm()
    }
  }

  const toastIdRef = React.useRef(`toast-${Date.now()}-${Math.random()}`)
  const TOAST_ID = toastIdRef.current

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const toastId = `${TOAST_ID}-edit-reward-per-payout`

    try {
      setIsSigning(true)

      if (!activeAddress) {
        throw new Error('No active address')
      }

      if (!validator.rewardToken) {
        throw new Error('No reward token found')
      }

      const newRewardPerPayoutBaseUnits = convertToBaseUnits(
        values.rewardPerPayout,
        validator.rewardToken.params.decimals,
      )

      toast.loading('Sign transactions to update reward amount per payout...', { id: toastId })

      await changeValidatorRewardInfo(
        validator.id,
        entryGatingType,
        entryGatingAddress,
        entryGatingAssets,
        gatingAssetMinBalance,
        BigInt(newRewardPerPayoutBaseUnits),
        transactionSigner,
        activeAddress,
      )

      toast.success(`Reward amount per payout updated!`, {
        id: toastId,
        duration: 5000,
      })

      // Refetch validator data
      const newData = await fetchValidator(validator!.id)

      // Seed/update query cache with new data
      setValidatorQueriesData(queryClient, newData)
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
      description={`Set the amount of ${tokenUnitName || 'reward tokens'} paid out each epoch for Validator ${validator.id}`}
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
                  <FormLabel htmlFor="edit-reward-per-payout-input">Amount per payout</FormLabel>
                  <FormControl>
                    <Input id="edit-reward-per-payout-input" placeholder="0.000000" {...field} />
                  </FormControl>
                  <FormDescription>Enter amount in whole units (not base units)</FormDescription>
                  <FormMessage>{errors.rewardPerPayout?.message}</FormMessage>
                </FormItem>
              )}
            />
          </div>
          <DialogFooter className="mt-4">
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
