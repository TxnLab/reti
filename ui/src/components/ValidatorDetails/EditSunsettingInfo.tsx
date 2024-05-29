import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@txnlab/use-wallet-react'
import { CalendarIcon, RotateCcw } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { changeValidatorSunsetInfo, fetchValidator } from '@/api/contracts'
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
import { InsufficientBalanceError } from '@/utils/balanceChecker'
import { setValidatorQueriesData } from '@/utils/contracts'
import { dayjs } from '@/utils/dayjs'
import { cn } from '@/utils/ui'
import { validatorSchemas } from '@/utils/validation'

interface EditSunsettingInfoProps {
  validator: Validator
}

export function EditSunsettingInfo({ validator }: EditSunsettingInfoProps) {
  const [isOpen, setIsOpen] = React.useState<boolean>(false)
  const [isSigning, setIsSigning] = React.useState(false)
  const [isCalendarOpen, setIsCalendarOpen] = React.useState(false)

  const { transactionSigner, activeAddress } = useWallet()
  const queryClient = useQueryClient()

  const formSchema = z.object({
    enableSunset: validatorSchemas.enableSunset(),
    sunsettingOn: validatorSchemas.sunsettingOn(),
    sunsettingTo: validatorSchemas.sunsettingTo(),
  })

  const { sunsettingOn, sunsettingTo } = validator.config
  const defaultValues = {
    enableSunset: sunsettingOn > 0,
    sunsettingOn: sunsettingOn > 0 ? dayjs.unix(sunsettingOn).toDate() : undefined,
    sunsettingTo: String(sunsettingTo || ''),
  }

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues,
  })

  const { errors, isDirty } = form.formState

  const $enableSunset = form.watch('enableSunset')

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
    const toastId = `${TOAST_ID}-edit-sunset-info`

    try {
      setIsSigning(true)

      if (!activeAddress) {
        throw new Error('No active address')
      }

      const newSunsettingOn = values.enableSunset ? dayjs(values.sunsettingOn).unix() : 0
      const newSunsettingTo =
        values.enableSunset && values.sunsettingTo !== '' ? Number(values.sunsettingTo) : 0

      toast.loading('Sign transactions to update sunsetting info...', { id: toastId })

      await changeValidatorSunsetInfo(
        validator.id,
        newSunsettingOn,
        newSunsettingTo,
        transactionSigner,
        activeAddress,
      )

      toast.success(`Sunsetting info updated!`, {
        id: toastId,
        duration: 5000,
      })

      // Refetch validator data
      const newData = await fetchValidator(validator!.id)

      // Seed/update query cache with new data
      setValidatorQueriesData(queryClient, newData)
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        toast.error('Insufficient balance', {
          id: toastId,
          description: error.toastMessage,
          duration: 5000,
        })
      } else {
        toast.error('Failed to update sunsetting info', { id: toastId })
      }
      console.error(error)
    } finally {
      setIsSigning(false)
      handleResetForm()
      setIsOpen(false)
    }
  }

  return (
    <EditValidatorModal
      title="Edit Sunset Date"
      description={`Set a date to decommission Validator ${validator.id}`}
      open={isOpen}
      onOpenChange={handleOpenChange}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
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
              className={cn('grid gap-4 grid-cols-5 sm:grid-cols-2 transition-opacity', {
                'opacity-0 pointer-events-none': !$enableSunset,
              })}
            >
              <FormField
                control={form.control}
                name="sunsettingOn"
                render={({ field }) => (
                  <FormItem className="col-span-3 sm:col-auto">
                    <FormLabel className={cn({ 'pointer-events-none': !$enableSunset })}>
                      Sunset date
                    </FormLabel>
                    <div className="flex items-center gap-x-3">
                      <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className={cn(
                                'w-[240px] h-9 pl-3 text-left font-normal disabled:cursor-not-allowed',
                                !field.value && 'text-muted-foreground',
                              )}
                              disabled={!$enableSunset}
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
                            disabled={(date) => dayjs(date).isBefore(dayjs().startOf('day'))}
                            onDayClick={() => setIsCalendarOpen(false)}
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
                  <FormItem className="col-span-2 sm:col-auto">
                    <FormLabel>
                      Migrate to
                      <InfoPopover className="mx-1.5 relative top-0.5 sm:mx-1 sm:top-0">
                        Validator ID that stakers should migrate to, if known (optional)
                      </InfoPopover>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="" disabled={!$enableSunset} {...field} />
                    </FormControl>
                    <FormMessage>{errors.sunsettingTo?.message}</FormMessage>
                  </FormItem>
                )}
              />
            </div>
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
