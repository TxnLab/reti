import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { RotateCcw } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { changeValidatorCommissionAddress } from '@/api/contracts'
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

interface EditCommissionAccountProps {
  validator: Validator
}

export function EditCommissionAccount({ validator }: EditCommissionAccountProps) {
  const [isOpen, setIsOpen] = React.useState<boolean>(false)
  const [isSigning, setIsSigning] = React.useState(false)

  const { transactionSigner, activeAddress } = useWallet()
  const queryClient = useQueryClient()
  const router = useRouter()

  const formSchema = z.object({
    validatorCommissionAddress: z
      .string()
      .refine((val) => val !== '', {
        message: 'Required field',
      })
      .refine((val) => algosdk.isValidAddress(val), {
        message: 'Invalid Algorand address',
      }),
  })

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: {
      validatorCommissionAddress: validator.config.validatorCommissionAddress,
    },
  })

  const { errors, isDirty } = form.formState

  const handleResetForm = () => {
    form.resetField('validatorCommissionAddress')
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

      toast.loading('Sign transactions to update commission account...', {
        id: toastId,
      })

      await changeValidatorCommissionAddress(
        validator.id,
        values.validatorCommissionAddress,
        transactionSigner,
        activeAddress,
      )

      toast.success(`Commission account updated!`, {
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
                validatorCommissionAddress: values.validatorCommissionAddress,
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
      toast.error('Failed to update commission account', { id: toastId })
      console.error(error)
    } finally {
      setIsSigning(false)
      handleResetForm()
      setIsOpen(false)
    }
  }

  return (
    <EditValidatorModal
      title="Edit Commission Account"
      description={`Set a new commission account for Validator ${validator.id}`}
      open={isOpen}
      onOpenChange={handleOpenChange}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="">
          <div className="grid gap-4 py-4">
            <FormField
              control={form.control}
              name="validatorCommissionAddress"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Commission account</FormLabel>
                  <div className="flex items-center gap-x-3">
                    <FormControl>
                      <Input
                        className="font-mono"
                        placeholder=""
                        autoComplete="new-password"
                        spellCheck="false"
                        {...field}
                      />
                    </FormControl>
                  </div>
                  <FormMessage>{errors.validatorCommissionAddress?.message}</FormMessage>
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
