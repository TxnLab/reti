import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@txnlab/use-wallet-react'
import { isAxiosError } from 'axios'
import { ArrowUpRight, Check, RotateCcw, X } from 'lucide-react'
import * as React from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { useDebouncedCallback } from 'use-debounce'
import { z } from 'zod'
import { changeValidatorRewardInfo, fetchValidator } from '@/api/contracts'
import { fetchNfd } from '@/api/nfd'
import { nfdQueryOptions } from '@/api/queries'
import { AssetLookup } from '@/components/AssetLookup'
import { InfoPopover } from '@/components/InfoPopover'
import { Tooltip } from '@/components/Tooltip'
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
import { Asset } from '@/interfaces/algod'
import { EntryGatingAssets, Validator } from '@/interfaces/validator'
import { InsufficientBalanceError } from '@/utils/balanceChecker'
import { setValidatorQueriesData, transformEntryGatingAssets } from '@/utils/contracts'
import { convertFromBaseUnits } from '@/utils/format'
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
  const [gatingAssets, setGatingAssets] = React.useState<Array<Asset | null>>([])
  const [isFetchingGatingAssetIndex, setIsFetchingGatingAssetIndex] = React.useState<number>(-1)

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
    .superRefine((data, ctx) => entryGatingRefinement(data, ctx, gatingAssets))

  type FormValues = z.infer<typeof formSchema>

  const defaultGatingAssetMinBalance =
    gatingAssetMinBalance > 1
      ? convertFromBaseUnits(
          gatingAssetMinBalance,
          validator.gatingAssets?.[0].params.decimals,
        ).toString()
      : ''

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
    gatingAssetMinBalance: defaultGatingAssetMinBalance,
  }

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues,
  })

  const { errors, isDirty } = form.formState

  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: 'entryGatingAssets',
  })

  const handleAddAssetField = () => {
    append({ value: '' })
    setGatingAssets((prev) => [...prev, null])

    // Reset min balance if there are multiple assets
    form.setValue('gatingAssetMinBalance', '')
  }

  const handleRemoveAssetField = (index: number) => {
    if ($entryGatingAssets.length === 1) {
      replace([{ value: '' }])
    } else {
      remove(index)
    }

    setGatingAssets((prev) => {
      const newAssets = [...prev]
      newAssets.splice(index, 1)
      return newAssets
    })
  }

  const handleSetGatingAssetById = async (index: number, value: Asset | null) => {
    setGatingAssets((prev) => {
      const newAssets = [...prev]
      newAssets[index] = value
      return newAssets
    })
  }

  const handleSetIsFetchingGatingAssetIndex = (index: number, isFetching: boolean) => {
    if (isFetching) {
      setIsFetchingGatingAssetIndex(index)
    } else if (index === isFetchingGatingAssetIndex) {
      setIsFetchingGatingAssetIndex(-1)
    }
  }

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
  const $entryGatingAssets = form.watch('entryGatingAssets')
  const $entryGatingNfdParent = form.watch('entryGatingNfdParent')

  const showCreatorAddressField = $entryGatingType === String(GatingType.CreatorAccount)
  const showAssetFields = $entryGatingType === String(GatingType.AssetId)
  const showCreatorNfdField = $entryGatingType === String(GatingType.CreatorNfd)
  const showParentNfdField = $entryGatingType === String(GatingType.SegmentNfd)

  const showMinBalanceField =
    $entryGatingType === String(GatingType.AssetId) && $entryGatingAssets.length < 2

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

      const { entryGatingAssets, gatingAssetMinBalance } = transformEntryGatingAssets(
        values.entryGatingType,
        values.entryGatingAssets,
        gatingAssets,
        values.gatingAssetMinBalance,
        nfdCreatorAppId,
        nfdParentAppId,
      )

      const entryGatingAddress = values.entryGatingAddress || ALGORAND_ZERO_ADDRESS_STRING

      await changeValidatorRewardInfo(
        validator.id,
        Number(values.entryGatingType),
        entryGatingAddress,
        entryGatingAssets.map(Number) as EntryGatingAssets,
        BigInt(gatingAssetMinBalance),
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
        toast.error('Insufficient balance', {
          id: toastId,
          description: error.toastMessage,
          duration: 5000,
        })
      } else {
        toast.error('Failed to update entry gating', { id: toastId })
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
      title="Edit Entry Gating"
      description={`Require stakers to hold a qualified asset to add stake to Validator ${validator.id}`}
      open={isOpen}
      onOpenChange={handleOpenChange}
      className="max-w-[640px]"
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="">
          <div className="grid gap-4 py-4 sm:grid-cols-[14rem,1fr]">
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

                        // Reset gating assets
                        replace([{ value: '' }])
                        setGatingAssets([])

                        // Reset gating fields
                        form.setValue('entryGatingAddress', '')
                        form.setValue('entryGatingNfdCreator', '')
                        form.setValue('entryGatingNfdParent', '')
                        form.setValue('gatingAssetMinBalance', '')

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
                <div key={field.id} className="flex items-end">
                  <AssetLookup
                    form={form}
                    name={`entryGatingAssets.${index}.value`}
                    className="flex-1"
                    label={
                      <FormLabel className={cn(index !== 0 && 'sr-only')}>
                        Asset ID
                        <InfoPopover className="mx-1.5 relative top-0.5 sm:mx-1 sm:top-0">
                          Must hold asset with this ID to enter pool
                        </InfoPopover>
                        <span className="text-primary">*</span>
                      </FormLabel>
                    }
                    asset={gatingAssets[index] || null}
                    setAsset={(asset) => handleSetGatingAssetById(index, asset)}
                    isFetching={isFetchingGatingAssetIndex === index}
                    setIsFetching={(isFetching) =>
                      handleSetIsFetchingGatingAssetIndex(index, isFetching)
                    }
                  />
                  <div
                    className={cn('flex items-center h-9 mt-2 ml-2', {
                      invisible: gatingAssets.length === 0,
                    })}
                  >
                    <Tooltip content="Remove">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="group h-8 w-8"
                        onClick={() => handleRemoveAssetField(index)}
                      >
                        <X className="h-4 w-4 opacity-60 transition-opacity group-hover:opacity-100" />
                      </Button>
                    </Tooltip>
                  </div>
                </div>
              ))}
              <FormMessage className="mt-2">{errors.entryGatingAssets?.root?.message}</FormMessage>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={handleAddAssetField}
                disabled={
                  fields.length >= 4 ||
                  $entryGatingAssets[fields.length - 1]?.value === '' ||
                  Array.isArray(errors.entryGatingAssets)
                }
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
                <FormItem
                  className={cn('sm:col-start-2 sm:col-end-3', { hidden: !showMinBalanceField })}
                >
                  <FormLabel>
                    Minimum balance
                    <InfoPopover className="mx-1.5 relative top-0.5 sm:mx-1 sm:top-0">
                      Optional minimum required balance of the entry gating asset.
                    </InfoPopover>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormDescription>No minimum if left blank</FormDescription>
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
