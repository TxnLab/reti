import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@txnlab/use-wallet-react'
import { isAxiosError } from 'axios'
import { ArrowUpRight, Check, RotateCcw } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { useDebouncedCallback } from 'use-debounce'
import { z } from 'zod'
import { changeValidatorNfd, fetchValidator } from '@/api/contracts'
import { fetchNfd } from '@/api/nfd'
import { InfoPopover } from '@/components/InfoPopover'
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
import { InsufficientBalanceError } from '@/utils/balanceChecker'
import { setValidatorQueriesData } from '@/utils/contracts'
import { getNfdAppFromViteEnvironment } from '@/utils/network/getNfdConfig'
import { isValidName, trimExtension } from '@/utils/nfd'
import { cn } from '@/utils/ui'
import { validatorSchemas } from '@/utils/validation'

const nfdAppUrl = getNfdAppFromViteEnvironment()

interface EditNfdForInfoProps {
  validator: Validator
}

export function EditNfdForInfo({ validator }: EditNfdForInfoProps) {
  const [isOpen, setIsOpen] = React.useState<boolean>(false)
  const [isSigning, setIsSigning] = React.useState(false)

  const { nfdForInfo } = validator.config

  const [isFetchingNfdForInfo, setIsFetchingNfdForInfo] = React.useState(false)
  const [nfdForInfoAppId, setNfdForInfoAppId] = React.useState<number>(nfdForInfo)

  const { transactionSigner, activeAddress } = useWallet()
  const queryClient = useQueryClient()

  const formSchema = z.object({
    nfdForInfo: validatorSchemas.nfdForInfo(),
  })

  const defaultValues = {
    nfdForInfo: validator.nfd?.name || '',
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

  const fetchNfdAppId = async (value: string) => {
    try {
      const nfd = await fetchNfd(value, { view: 'brief' })

      if (nfd.owner !== activeAddress) {
        throw new Error('NFD not owned by active address')
      }

      // If we have an app id, clear error if it exists
      form.clearErrors('nfdForInfo')
      setNfdForInfoAppId(nfd.appID!)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      let message: string
      if (isAxiosError(error) && error.response) {
        if (error.response.status === 404) {
          message = 'NFD app ID not found'
        } else {
          console.error(error)
          message = 'Failed to fetch NFD'
        }
      } else {
        // Handle non-HTTP errors
        console.error(error)
        message = error.message
      }
      form.setError('nfdForInfo', { type: 'manual', message })
    } finally {
      setIsFetchingNfdForInfo(false)
    }
  }

  const debouncedNfdForInfoCheck = useDebouncedCallback(async (value) => {
    const isValid = await form.trigger('nfdForInfo')
    if (isValid) {
      await fetchNfdAppId(value)
    } else {
      setIsFetchingNfdForInfo(false)
    }
  }, 500)

  const $nfdForInfo = form.watch('nfdForInfo')

  const showPrimaryMintNfd = (
    name: string,
    isFetching: boolean,
    appId: number,
    errorMessage?: string,
  ) => {
    return (
      !isFetching && appId === 0 && errorMessage === 'NFD app ID not found' && isValidName(name)
    )
  }

  const getNfdMintUrl = (name: string, showPrimary: boolean) => {
    return showPrimary ? `${nfdAppUrl}/mint?q=${trimExtension(name)}` : `${nfdAppUrl}/mint`
  }

  const toastIdRef = React.useRef(`toast-${Date.now()}-${Math.random()}`)
  const TOAST_ID = toastIdRef.current

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const toastId = `${TOAST_ID}-edit-nfd-for-info`

    try {
      setIsSigning(true)

      if (!activeAddress) {
        throw new Error('No active address')
      }

      toast.loading('Sign transactions to update validator NFD...', { id: toastId })

      await changeValidatorNfd(
        validator.id,
        nfdForInfoAppId,
        values.nfdForInfo,
        transactionSigner,
        activeAddress,
      )

      toast.success(`NFD updated!`, {
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
        toast.error('Failed to update validator NFD', { id: toastId })
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
      title="Edit Validator NFD"
      description={`Set a new NFD for Validator ${validator.id}`}
      open={isOpen}
      onOpenChange={handleOpenChange}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="">
          <div className="grid gap-4 py-4">
            <FormField
              control={form.control}
              name="nfdForInfo"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>
                    Associated NFD
                    <InfoPopover className="mx-1.5 relative top-0.5 sm:mx-1 sm:top-0">
                      NFD which the validator uses to describe their validator pool (optional)
                    </InfoPopover>
                  </FormLabel>
                  <div className="flex items-center gap-x-3">
                    <div className="flex-1 relative">
                      <FormControl>
                        <Input
                          className={cn(isFetchingNfdForInfo || nfdForInfoAppId > 0 ? 'pr-10' : '')}
                          placeholder=""
                          autoComplete="new-password"
                          spellCheck="false"
                          {...field}
                          onChange={(e) => {
                            field.onChange(e) // Inform react-hook-form of the change
                            setNfdForInfoAppId(0) // Reset NFD app ID
                            setIsFetchingNfdForInfo(true) // Set fetching state
                            debouncedNfdForInfoCheck(e.target.value) // Perform debounced validation
                          }}
                        />
                      </FormControl>
                      <div
                        className={cn(
                          isFetchingNfdForInfo || nfdForInfoAppId > 0 ? 'opacity-100' : 'opacity-0',
                          'pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3',
                        )}
                      >
                        {isFetchingNfdForInfo ? (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-5 w-5 animate-spin opacity-25"
                            aria-hidden="true"
                          >
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                          </svg>
                        ) : nfdForInfoAppId ? (
                          <Check className="h-5 w-5 text-green-500" />
                        ) : null}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={
                        showPrimaryMintNfd(
                          $nfdForInfo,
                          isFetchingNfdForInfo,
                          nfdForInfoAppId,
                          errors.nfdForInfo?.message,
                        )
                          ? 'default'
                          : 'outline'
                      }
                      asChild
                    >
                      <a
                        href={getNfdMintUrl(
                          $nfdForInfo,
                          showPrimaryMintNfd(
                            $nfdForInfo,
                            isFetchingNfdForInfo,
                            nfdForInfoAppId,
                            errors.nfdForInfo?.message,
                          ),
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ArrowUpRight className="hidden mr-1 h-5 w-5 opacity-75 sm:inline" />
                        Mint NFD
                      </a>
                    </Button>
                  </div>
                  <FormMessage>{errors.nfdForInfo?.message}</FormMessage>
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
