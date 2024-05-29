import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@txnlab/use-wallet-react'
import { isAxiosError } from 'axios'
import { ArrowUpRight, Check, RotateCcw } from 'lucide-react'
import * as React from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { useDebouncedCallback } from 'use-debounce'
import { z } from 'zod'
import { changeValidatorRewardInfo, fetchValidator } from '@/api/contracts'
import { fetchNfd } from '@/api/nfd'
import { nfdQueryOptions } from '@/api/queries'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EditValidatorModal } from '@/components/ValidatorDetails/EditValidatorModal'
import { ALGORAND_ZERO_ADDRESS_STRING } from '@/constants/accounts'
import { GatingType } from '@/constants/gating'
import { EntryGatingAssets, Validator } from '@/interfaces/validator'
import { InsufficientBalanceError } from '@/utils/balanceChecker'
import { setValidatorQueriesData, transformEntryGatingAssets } from '@/utils/contracts'
import { getNfdAppFromViteEnvironment } from '@/utils/network/getNfdConfig'
import { isValidName, trimExtension } from '@/utils/nfd'
import { cn } from '@/utils/ui'
import { entryGatingRefinement, validatorSchemas } from '@/utils/validation'

const nfdAppUrl = getNfdAppFromViteEnvironment()

interface EditEntryGatingProps {
  validator: Validator
}

export function EditEntryGating({ validator }: EditEntryGatingProps) {
  const [isOpen, setIsOpen] = React.useState<boolean>(false)
  const [isSigning, setIsSigning] = React.useState(false)

  const {
    entryGatingType,
    entryGatingAddress,
    entryGatingAssets,
    gatingAssetMinBalance,
    rewardPerPayout,
  } = validator.config

  const [isFetchingNfdCreator, setIsFetchingNfdCreator] = React.useState(false)
  const [nfdCreatorAppId, setNfdCreatorAppId] = React.useState<number>(
    entryGatingType === GatingType.CreatorNfd ? entryGatingAssets[0] : 0,
  )

  const [isFetchingNfdParent, setIsFetchingNfdParent] = React.useState(false)
  const [nfdParentAppId, setNfdParentAppId] = React.useState<number>(
    entryGatingType === GatingType.SegmentNfd ? entryGatingAssets[0] : 0,
  )

  const nfdCreatorQuery = useQuery(nfdQueryOptions(nfdCreatorAppId))
  const nfdParentQuery = useQuery(nfdQueryOptions(nfdParentAppId))

  const { transactionSigner, activeAddress } = useWallet()
  const queryClient = useQueryClient()

  const formSchema = z
    .object({
      entryGatingType: validatorSchemas.entryGatingType(),
      entryGatingAddress: validatorSchemas.entryGatingAddress(),
      entryGatingAssets: validatorSchemas.entryGatingAssets(),
      entryGatingNfdCreator: validatorSchemas.entryGatingNfdCreator(),
      entryGatingNfdParent: validatorSchemas.entryGatingNfdParent(),
      gatingAssetMinBalance: validatorSchemas.gatingAssetMinBalance(),
    })
    .superRefine((data, ctx) => entryGatingRefinement(data, ctx))

  type FormValues = z.infer<typeof formSchema>

  const defaultValues = {
    entryGatingType: String(entryGatingType),
    entryGatingAddress: entryGatingAddress,
    entryGatingAssets:
      entryGatingType === GatingType.AssetId
        ? entryGatingAssets
            .filter((assetId) => assetId > 0)
            .map((assetId) => ({ value: String(assetId) }))
        : [{ value: '' }],
    entryGatingNfdCreator: nfdCreatorQuery.data?.name || '',
    entryGatingNfdParent: nfdParentQuery.data?.name || '',
    gatingAssetMinBalance: String(gatingAssetMinBalance),
  }

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues,
  })

  const { errors, isDirty } = form.formState

  const { fields, append, replace } = useFieldArray({
    control: form.control,
    name: 'entryGatingAssets',
  })

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

  const $entryGatingType = form.watch('entryGatingType')

  const showCreatorAddressField = $entryGatingType === String(GatingType.CreatorAccount)
  const showAssetFields = $entryGatingType === String(GatingType.AssetId)
  const showCreatorNfdField = $entryGatingType === String(GatingType.CreatorNfd)
  const showParentNfdField = $entryGatingType === String(GatingType.SegmentNfd)

  const showMinBalanceField = [
    String(GatingType.CreatorAccount),
    String(GatingType.AssetId),
    String(GatingType.CreatorNfd),
  ].includes($entryGatingType)

  const fetchNfdAppId = async (
    value: string,
    field: keyof FormValues,
    setValue: React.Dispatch<React.SetStateAction<number>>,
    setFetching: React.Dispatch<React.SetStateAction<boolean>>,
  ) => {
    try {
      const nfd = await fetchNfd(value, { view: 'brief' })

      // If we have an app id, clear error if it exists
      form.clearErrors(field)
      setValue(nfd.appID!)
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
      form.setError(field, { type: 'manual', message })
    } finally {
      setFetching(false)
    }
  }

  const debouncedNfdCreatorCheck = useDebouncedCallback(async (value) => {
    const isValid = await form.trigger('entryGatingNfdCreator')
    if (isValid) {
      await fetchNfdAppId(
        value,
        'entryGatingNfdCreator',
        setNfdCreatorAppId,
        setIsFetchingNfdCreator,
      )
    } else {
      setIsFetchingNfdCreator(false)
    }
  }, 500)

  const debouncedNfdParentCheck = useDebouncedCallback(async (value) => {
    const isValid = await form.trigger('entryGatingNfdParent')
    if (isValid) {
      await fetchNfdAppId(value, 'entryGatingNfdParent', setNfdParentAppId, setIsFetchingNfdParent)
    } else {
      setIsFetchingNfdParent(false)
    }
  }, 500)

  const $entryGatingNfdParent = form.watch('entryGatingNfdParent')

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
    const toastId = `${TOAST_ID}-edit-entry-gating`

    try {
      setIsSigning(true)

      if (!activeAddress) {
        throw new Error('No active address')
      }

      toast.loading('Sign transactions to update entry gating...', { id: toastId })

      const gatingAssets = transformEntryGatingAssets(
        values.entryGatingType,
        values.entryGatingAssets,
        nfdCreatorAppId,
        nfdParentAppId,
      ).map(Number) as EntryGatingAssets

      const gatingType = Number(values.entryGatingType)
      const gatingAddress = values.entryGatingAddress || ALGORAND_ZERO_ADDRESS_STRING
      const gatingAssetMinBalance = BigInt(values.gatingAssetMinBalance)

      await changeValidatorRewardInfo(
        validator.id,
        gatingType,
        gatingAddress,
        gatingAssets,
        gatingAssetMinBalance,
        rewardPerPayout,
        transactionSigner,
        activeAddress,
      )

      toast.success(`Entry gating updated!`, {
        id: toastId,
        duration: 5000,
      })

      // Refetch validator data
      const newData = await fetchValidator(validator!.id)

      // Seed/update query cache with new data
      setValidatorQueriesData(queryClient, newData)
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        toast.error(error.message, { id: toastId })
        console.error(error.message)
      } else {
        toast.error('Failed to update entry gating', { id: toastId })
        console.error(error)
      }
    } finally {
      setIsSigning(false)
      handleResetForm()
      setIsOpen(false)
    }
  }

  return (
    <EditValidatorModal
      title="Edit Entry Gating"
      description={`Require stakers to hold a qualified asset to enter pool on Validator ${validator.id}`}
      open={isOpen}
      onOpenChange={handleOpenChange}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="">
          <div className="grid gap-4 py-4">
            <FormField
              control={form.control}
              name="entryGatingType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Gating type
                    <InfoPopover className="mx-1.5 relative top-0.5 sm:mx-1 sm:top-0">
                      Require stakers to hold a qualified asset to enter pool (optional)
                    </InfoPopover>
                  </FormLabel>
                  <FormControl>
                    <Select
                      value={field.value}
                      onValueChange={(type) => {
                        field.onChange(type) // Inform react-hook-form of the change

                        // Reset form fields
                        replace([{ value: '' }])
                        form.setValue('entryGatingAddress', '')
                        form.setValue('entryGatingNfdCreator', '')
                        form.setValue('entryGatingNfdParent', '')
                        form.setValue(
                          'gatingAssetMinBalance',
                          type === String(GatingType.SegmentNfd) ? '1' : '',
                        )

                        // Clear any errors
                        form.clearErrors('entryGatingAssets')
                        form.clearErrors('entryGatingAddress')
                        form.clearErrors('entryGatingNfdCreator')
                        form.clearErrors('entryGatingNfdParent')
                        form.clearErrors('gatingAssetMinBalance')
                      }}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select asset gating type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={String(GatingType.None)}>None</SelectItem>
                        <SelectItem value={String(GatingType.CreatorAccount)}>
                          Asset by Creator Account
                        </SelectItem>
                        <SelectItem value={String(GatingType.AssetId)}>Asset ID</SelectItem>
                        <SelectItem value={String(GatingType.CreatorNfd)}>
                          Asset Created by NFD
                        </SelectItem>
                        <SelectItem value={String(GatingType.SegmentNfd)}>NFD Segment</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage>{errors.entryGatingType?.message}</FormMessage>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="entryGatingAddress"
              render={({ field }) => (
                <FormItem className={cn({ hidden: !showCreatorAddressField })}>
                  <FormLabel>
                    Asset creator account
                    <InfoPopover className="mx-1.5 relative top-0.5 sm:mx-1 sm:top-0">
                      Must hold asset created by this account to enter pool
                    </InfoPopover>
                    <span className="text-primary">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input className="font-mono" placeholder="" {...field} />
                  </FormControl>
                  <FormMessage>{errors.entryGatingAddress?.message}</FormMessage>
                </FormItem>
              )}
            />

            <div className={cn({ hidden: !showAssetFields })}>
              {fields.map((field, index) => (
                <FormField
                  control={form.control}
                  key={field.id}
                  name={`entryGatingAssets.${index}.value`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={cn(index !== 0 && 'sr-only')}>
                        Asset ID
                        <InfoPopover className="mx-1.5 relative top-0.5 sm:mx-1 sm:top-0">
                          Must hold asset with this ID to enter pool
                        </InfoPopover>
                        <span className="text-primary">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          className="font-mono placeholder:font-sans"
                          placeholder="Enter asset ID"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
              <FormMessage className="mt-2">{errors.entryGatingAssets?.root?.message}</FormMessage>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => append({ value: '' })}
                disabled={fields.length >= 4}
              >
                Add Asset
              </Button>
            </div>

            <FormField
              control={form.control}
              name="entryGatingNfdCreator"
              render={({ field }) => (
                <FormItem className={cn({ hidden: !showCreatorNfdField })}>
                  <FormLabel>
                    Asset creator NFD
                    <InfoPopover className="mx-1.5 relative top-0.5 sm:mx-1 sm:top-0">
                      Must hold asset created by an account linked to this NFD to enter pool
                    </InfoPopover>
                    <span className="text-primary">*</span>
                  </FormLabel>
                  <div className="relative">
                    <FormControl>
                      <Input
                        className={cn(isFetchingNfdCreator || nfdCreatorAppId > 0 ? 'pr-10' : '')}
                        placeholder=""
                        autoComplete="new-password"
                        spellCheck="false"
                        {...field}
                        onChange={(e) => {
                          field.onChange(e) // Inform react-hook-form of the change
                          setNfdCreatorAppId(0) // Reset NFD app ID
                          setIsFetchingNfdCreator(true) // Set fetching state
                          debouncedNfdCreatorCheck(e.target.value) // Perform debounced validation
                        }}
                      />
                    </FormControl>
                    <div
                      className={cn(
                        isFetchingNfdCreator || nfdCreatorAppId > 0 ? 'opacity-100' : 'opacity-0',
                        'pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3',
                      )}
                    >
                      {isFetchingNfdCreator ? (
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
                      ) : nfdCreatorAppId ? (
                        <Check className="h-5 w-5 text-green-500" />
                      ) : null}
                    </div>
                  </div>
                  <FormMessage>{errors.entryGatingNfdCreator?.message}</FormMessage>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="entryGatingNfdParent"
              render={({ field }) => (
                <FormItem className={cn({ hidden: !showParentNfdField })}>
                  <FormLabel>
                    Root/parent NFD
                    <InfoPopover className="mx-1.5 relative top-0.5 sm:mx-1 sm:top-0">
                      Must hold a segment of this root/parent NFD to enter pool
                    </InfoPopover>
                    <span className="text-primary">*</span>
                  </FormLabel>
                  <div className="flex items-center gap-x-3">
                    <div className="flex-1 relative">
                      <FormControl>
                        <Input
                          className={cn(
                            '',
                            isFetchingNfdParent || nfdParentAppId > 0 ? 'pr-10' : '',
                          )}
                          placeholder=""
                          autoComplete="new-password"
                          spellCheck="false"
                          {...field}
                          onChange={(e) => {
                            field.onChange(e) // Inform react-hook-form of the change
                            setNfdParentAppId(0) // Reset NFD app ID
                            setIsFetchingNfdParent(true) // Set fetching state
                            debouncedNfdParentCheck(e.target.value) // Perform debounced validation
                          }}
                        />
                      </FormControl>
                      <div
                        className={cn(
                          isFetchingNfdParent || nfdParentAppId > 0 ? 'opacity-100' : 'opacity-0',
                          'pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3',
                        )}
                      >
                        {isFetchingNfdParent ? (
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
                        ) : nfdParentAppId ? (
                          <Check className="h-5 w-5 text-green-500" />
                        ) : null}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={
                        showPrimaryMintNfd(
                          $entryGatingNfdParent,
                          isFetchingNfdParent,
                          nfdParentAppId,
                          errors.entryGatingNfdParent?.message,
                        )
                          ? 'default'
                          : 'outline'
                      }
                      asChild
                    >
                      <a
                        href={getNfdMintUrl(
                          $entryGatingNfdParent,
                          showPrimaryMintNfd(
                            $entryGatingNfdParent,
                            isFetchingNfdParent,
                            nfdParentAppId,
                            errors.entryGatingNfdParent?.message,
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
                  <FormMessage>{errors.entryGatingNfdParent?.message}</FormMessage>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="gatingAssetMinBalance"
              render={({ field }) => (
                <FormItem className={cn({ hidden: !showMinBalanceField })}>
                  <FormLabel>
                    Minimum balance
                    <InfoPopover className="mx-1.5 relative top-0.5 sm:mx-1 sm:top-0">
                      Minimum required balance of the entry gating asset
                    </InfoPopover>
                    <span className="text-primary">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="" {...field} />
                  </FormControl>
                  <FormMessage>{errors.gatingAssetMinBalance?.message}</FormMessage>
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
