import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet-react'
import { CalendarIcon, RotateCcw } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { changeValidatorSunsetInfo } from '@/api/contracts'
import { InfoPopover } from '@/components/InfoPopover'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { EditValidatorModal } from '@/components/ValidatorDetails/EditValidatorModal'
import { Validator } from '@/interfaces/validator'
import { dayjs } from '@/utils/dayjs'
import { cn } from '@/utils/ui'

interface EditSunsettingInfoProps {
  validator: Validator
}

export function EditSunsettingInfo({ validator }: EditSunsettingInfoProps) {
  const [isOpen, setIsOpen] = React.useState<boolean>(false)
  const [isSigning, setIsSigning] = React.useState(false)

  const { transactionSigner, activeAddress } = useWallet()
  const queryClient = useQueryClient()
  const router = useRouter()

  const formSchema = z.object({
    enableSunset: z.boolean(),
    sunsettingOn: z.date({
      required_error: 'Required field',
    }),
    sunsettingTo: z
      .string()
      .refine(
        (val) =>
          val === '' || (!isNaN(Number(val)) && Number.isInteger(Number(val)) && Number(val) > 0),
        {
          message: 'Invalid validator id',
        },
      ),
  })

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      enableSunset: validator.config.sunsettingOn > 0,
      sunsettingOn:
        validator.config.sunsettingOn > 0
          ? dayjs.unix(validator.config.sunsettingOn).toDate()
          : undefined,
      sunsettingTo: String(validator.config.sunsettingTo || ''),
    },
  })

  const { errors, isDirty } = form.formState

  const enableSunset = form.watch('enableSunset')

  const handleResetForm = () => {
    form.reset({
      enableSunset: validator.config.sunsettingOn > 0,
      sunsettingOn:
        validator.config.sunsettingOn > 0
          ? dayjs.unix(validator.config.sunsettingOn).toDate()
          : undefined,
      sunsettingTo: String(validator.config.sunsettingTo || ''),
    })
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

  const infoPopoverClassName = 'mx-1.5 relative top-0.5 sm:mx-1 sm:top-0'

  const toastIdRef = React.useRef(`toast-${Date.now()}-${Math.random()}`)
  const TOAST_ID = toastIdRef.current

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const toastId = `${TOAST_ID}-validator`

    try {
      setIsSigning(true)

      if (!activeAddress) {
        throw new Error('No active address')
      }

      const sunsettingOn = values.enableSunset ? dayjs(values.sunsettingOn).unix() : 0
      const sunsettingTo =
        values.enableSunset && values.sunsettingTo !== '' ? Number(values.sunsettingTo) : 0

      toast.loading('Sign transactions to update sunsetting info...', { id: toastId })

      await changeValidatorSunsetInfo(
        validator.id,
        sunsettingOn,
        sunsettingTo,
        transactionSigner,
        activeAddress,
      )

      toast.success(`Sunsetting info updated!`, {
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
                sunsettingOn,
                sunsettingTo,
              },
            }
          }

          return validator
        })
      })

      // Invalidate other queries to update UI
      queryClient.invalidateQueries({ queryKey: ['validator', String(validator!.id)] })
      router.invalidate()
    } catch (error) {
      toast.error('Failed to update sunsetting info', { id: toastId })
      console.error(error)
    } finally {
      setIsSigning(false)
      handleResetForm()
      setIsOpen(false)
    }
  }

  return (
    <EditValidatorModal
      title="Edit Sunsetting Info"
      description={`Set sunsetting info for Validator ${validator.id}`}
      open={isOpen}
      onOpenChange={handleOpenChange}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="">
          <div className="grid gap-4 py-4">
            <FormField
              control={form.control}
              name="enableSunset"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-x-4 rounded-lg border p-3 shadow-sm">
                  <div className="space-y-0.5">
                    <FormLabel>Enable Validator Sunset</FormLabel>
                    <FormDescription>
                      Set a date after which stake can no longer be added to this validator
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={(e) => {
                        field.onChange(e)
                        if (!e) {
                          form.resetField('sunsettingOn')
                          form.resetField('sunsettingTo')
                        }
                      }}
                      aria-readonly
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div
              className={cn('grid gap-4 sm:grid-cols-2', {
                'opacity-25 pointer-events-none': !enableSunset,
              })}
            >
              <FormField
                control={form.control}
                name="sunsettingOn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Sunset date
                      <InfoPopover className={infoPopoverClassName}>
                        Date when validator will sunset
                      </InfoPopover>
                    </FormLabel>
                    <div className="flex items-center gap-x-3">
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className={cn(
                                'w-[240px] h-9 pl-3 text-left font-normal',
                                !field.value && 'text-muted-foreground',
                              )}
                            >
                              {field.value ? (
                                dayjs(field.value).format('LL')
                              ) : (
                                <span>Select a date</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            defaultMonth={field.value}
                            selected={field.value}
                            onSelect={field.onChange}
                            disabled={(date) => date < dayjs().add(24, 'hours').toDate()}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <FormMessage>{errors.sunsettingOn?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sunsettingTo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Sunset to (validator ID)
                      <InfoPopover className={infoPopoverClassName}>
                        Validator ID that the validator is moving to (if known)
                      </InfoPopover>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="" {...field} />
                    </FormControl>
                    <FormMessage>{errors.sunsettingTo?.message}</FormMessage>
                  </FormItem>
                )}
              />
            </div>
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
