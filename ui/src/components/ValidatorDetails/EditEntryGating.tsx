import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { isAxiosError } from 'axios'
import { ArrowUpRight, Check, RotateCcw } from 'lucide-react'
import * as React from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { useDebouncedCallback } from 'use-debounce'
import { z } from 'zod'
import { changeValidatorRewardInfo } from '@/api/contracts'
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
import {
  GATING_TYPE_ASSETS_CREATED_BY,
  GATING_TYPE_ASSET_ID,
  GATING_TYPE_CREATED_BY_NFD_ADDRESSES,
  GATING_TYPE_NONE,
  GATING_TYPE_SEGMENT_OF_NFD,
} from '@/constants/gating'
import { EntryGatingAssets, Validator } from '@/interfaces/validator'
import { transformEntryGatingAssets } from '@/utils/contracts'
import { getNfdAppFromViteEnvironment } from '@/utils/network/getNfdConfig'
import { isValidName, isValidRoot, trimExtension } from '@/utils/nfd'
import { cn } from '@/utils/ui'

const nfdAppUrl = getNfdAppFromViteEnvironment()

interface EditEntryGatingProps {
  validator: Validator
}

export function EditEntryGating({ validator }: EditEntryGatingProps) {
  const [isOpen, setIsOpen] = React.useState<boolean>(false)
  const [isSigning, setIsSigning] = React.useState(false)

  const [nfdCreatorAppId, setNfdCreatorAppId] = React.useState<number>(
    validator.config.entryGatingType === GATING_TYPE_CREATED_BY_NFD_ADDRESSES
      ? validator.config.entryGatingAssets[0]
      : 0,
  )
  const [isFetchingNfdCreator, setIsFetchingNfdCreator] = React.useState(false)

  const [nfdParentAppId, setNfdParentAppId] = React.useState<number>(
    validator.config.entryGatingType === GATING_TYPE_SEGMENT_OF_NFD
      ? validator.config.entryGatingAssets[0]
      : 0,
  )
  const [isFetchingNfdParent, setIsFetchingNfdParent] = React.useState(false)

  const { transactionSigner, activeAddress } = useWallet()
  const queryClient = useQueryClient()
  const router = useRouter()

  const formSchema = z
    .object({
      entryGatingType: z.string(),
      entryGatingAddress: z.string(),
      entryGatingAssets: z.array(
        z.object({
          value: z
            .string()
            .refine(
              (val) =>
                val === '' ||
                (!isNaN(Number(val)) && Number.isInteger(Number(val)) && Number(val) > 0),
              {
                message: 'Invalid asset ID',
              },
            ),
        }),
      ),
      entryGatingNfdCreator: z.string().refine((val) => val === '' || isValidName(val), {
        message: 'NFD name is invalid',
      }),
      entryGatingNfdParent: z.string().refine((val) => val === '' || isValidRoot(val), {
        message: 'Root/parent NFD name is invalid',
      }),
      gatingAssetMinBalance: z
        .string()
        .refine((val) => val === '' || (!isNaN(Number(val)) && Number(val) > 0), {
          message: 'Invalid minimum balance',
        }),
    })
    .superRefine((data, ctx) => {
      const {
        entryGatingType,
        entryGatingAddress,
        entryGatingAssets,
        entryGatingNfdCreator,
        entryGatingNfdParent,
        gatingAssetMinBalance,
      } = data

      switch (entryGatingType) {
        case String(GATING_TYPE_NONE):
          if (entryGatingAddress !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAddress'],
              message: 'entryGatingAddress should not be set when entry gating is disabled',
            })
          } else if (entryGatingAssets.length > 1 || entryGatingAssets[0].value !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAssets'],
              message: 'entryGatingAssets should not be set when entry gating is disabled',
            })
          } else if (entryGatingNfdCreator !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingNfdCreator'],
              message: 'entryGatingNfdCreator should not be set when entry gating is disabled',
            })
          } else if (entryGatingNfdParent !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingNfdParent'],
              message: 'entryGatingNfdParent should not be set when entry gating is disabled',
            })
          }
          break
        case String(GATING_TYPE_ASSETS_CREATED_BY):
          if (
            typeof entryGatingAddress !== 'string' ||
            !algosdk.isValidAddress(entryGatingAddress)
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAddress'],
              message: 'Invalid Algorand address',
            })
          } else if (entryGatingAssets.length > 1 || entryGatingAssets[0].value !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAssets'],
              message: 'entryGatingAssets should not be set when entryGatingType is 1',
            })
          } else if (entryGatingNfdCreator !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingNfdCreator'],
              message: 'entryGatingNfdCreator should not be set when entryGatingType is 1',
            })
          } else if (entryGatingNfdParent !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingNfdParent'],
              message: 'entryGatingNfdParent should not be set when entryGatingType is 1',
            })
          }
          break
        case String(GATING_TYPE_ASSET_ID):
          if (entryGatingAssets.length === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAssets'],
              message: 'No gating asset(s) provided',
            })
          } else if (entryGatingAssets.length > 4) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAssets'],
              message: 'Cannot have more than 4 gating assets',
            })
          } else if (!entryGatingAssets.some((asset) => asset.value !== '')) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAssets'],
              message: 'Must provide at least one gating asset',
            })
          } else if (entryGatingAddress !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAddress'],
              message: 'entryGatingAddress should not be set when entryGatingType is 2',
            })
          } else if (entryGatingNfdCreator !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingNfdCreator'],
              message: 'entryGatingNfdCreator should not be set when entryGatingType is 2',
            })
          } else if (entryGatingNfdParent !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingNfdParent'],
              message: 'entryGatingNfdParent should not be set when entryGatingType is 2',
            })
          }
          break
        case String(GATING_TYPE_CREATED_BY_NFD_ADDRESSES):
          if (entryGatingAddress !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAddress'],
              message: 'entryGatingAddress should not be set when entryGatingType is 3',
            })
          } else if (entryGatingAssets.length > 1 || entryGatingAssets[0].value !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAssets'],
              message: 'entryGatingAssets should not be set when entryGatingType is 3',
            })
          } else if (entryGatingNfdParent !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingNfdParent'],
              message: 'entryGatingNfdParent should not be set when entryGatingType is 3',
            })
          }
          break
        case String(GATING_TYPE_SEGMENT_OF_NFD):
          if (entryGatingAddress !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAddress'],
              message: 'entryGatingAddress should not be set when entryGatingType is 4',
            })
          } else if (entryGatingAssets.length > 1 || entryGatingAssets[0].value !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingAssets'],
              message: 'entryGatingAssets should not be set when entryGatingType is 4',
            })
          } else if (entryGatingNfdCreator !== '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['entryGatingNfdCreator'],
              message: 'entryGatingNfdCreator should not be set when entryGatingType is 4',
            })
          }
          break
        default:
          break
      }

      const isGatingEnabled = [
        String(GATING_TYPE_ASSETS_CREATED_BY),
        String(GATING_TYPE_ASSET_ID),
        String(GATING_TYPE_CREATED_BY_NFD_ADDRESSES),
        String(GATING_TYPE_SEGMENT_OF_NFD),
      ].includes(String(entryGatingType))

      if (isGatingEnabled) {
        if (
          isNaN(Number(gatingAssetMinBalance)) ||
          !Number.isInteger(Number(gatingAssetMinBalance)) ||
          Number(gatingAssetMinBalance) <= 0
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['gatingAssetMinBalance'],
            message: 'Invalid minimum balance',
          })
        }
      } else if (gatingAssetMinBalance !== '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['gatingAssetMinBalance'],
          message: 'gatingAssetMinBalance should not be set when entry gating is disabled',
        })
      }
    })

  const nfdCreatorQuery = useQuery(nfdQueryOptions(nfdCreatorAppId))
  const nfdParentQuery = useQuery(nfdQueryOptions(nfdParentAppId))

  const defaultEntryGatingAssets =
    validator.config.entryGatingType === GATING_TYPE_ASSET_ID
      ? validator.config.entryGatingAssets
          .filter((assetId) => assetId > 0)
          .map((assetId) => ({ value: String(assetId) }))
      : [{ value: '' }]

  const defaultValues = {
    entryGatingType: String(validator.config.entryGatingType),
    entryGatingAddress: validator.config.entryGatingAddress,
    entryGatingAssets: defaultEntryGatingAssets,
    entryGatingNfdCreator: nfdCreatorQuery.data?.name || '',
    entryGatingNfdParent: nfdParentQuery.data?.name || '',
    gatingAssetMinBalance: String(validator.config.gatingAssetMinBalance),
  }

  type FormValues = z.infer<typeof formSchema>

  const form = useForm<FormValues>({
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
    }
  }

  const { fields, append, replace } = useFieldArray({
    control: form.control,
    name: 'entryGatingAssets',
  })

  const selectedGatingType = form.watch('entryGatingType')

  const isEntryGatingAddressEnabled = selectedGatingType === String(GATING_TYPE_ASSETS_CREATED_BY)
  const isEntryGatingAssetsEnabled = selectedGatingType === String(GATING_TYPE_ASSET_ID)
  const isEntryGatingNfdParentEnabled = selectedGatingType === String(GATING_TYPE_SEGMENT_OF_NFD)

  const isEntryGatingNfdCreatorEnabled =
    selectedGatingType === String(GATING_TYPE_CREATED_BY_NFD_ADDRESSES)

  const isGatingAssetMinBalanceEnabled = [
    String(GATING_TYPE_ASSETS_CREATED_BY),
    String(GATING_TYPE_ASSET_ID),
    String(GATING_TYPE_CREATED_BY_NFD_ADDRESSES),
  ].includes(selectedGatingType)

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

  const entryGatingNfdParent = form.watch('entryGatingNfdParent')

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

      toast.loading('Sign transactions to update entry gating...', { id: toastId })

      const { rewardPerPayout } = validator.config

      const entryGatingType = Number(values.entryGatingType)
      const entryGatingAddress = values.entryGatingAddress || ALGORAND_ZERO_ADDRESS_STRING
      const gatingAssetMinBalance = BigInt(values.gatingAssetMinBalance)

      const entryGatingAssets = transformEntryGatingAssets(
        values.entryGatingType,
        values.entryGatingAssets,
        nfdCreatorAppId,
        nfdParentAppId,
      ).map(Number) as EntryGatingAssets

      await changeValidatorRewardInfo(
        validator.id,
        entryGatingType,
        entryGatingAddress,
        entryGatingAssets,
        gatingAssetMinBalance,
        rewardPerPayout,
        transactionSigner,
        activeAddress,
      )

      toast.success(`Entry gating updated!`, {
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
                entryGatingType,
                entryGatingAddress,
                entryGatingAssets,
                gatingAssetMinBalance,
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
      toast.error('Failed to update entry gating', { id: toastId })
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
                    <InfoPopover className={infoPopoverClassName}>
                      Require stakers to hold a qualified asset to enter pool (optional)
                    </InfoPopover>
                  </FormLabel>
                  <FormControl>
                    <Select
                      value={field.value}
                      onValueChange={(gatingType) => {
                        field.onChange(gatingType) // Inform react-hook-form of the change

                        replace([{ value: '' }]) // Reset entryGatingAssets array
                        form.setValue('entryGatingAddress', '') // Reset entryGatingAddress
                        form.setValue('entryGatingNfdCreator', '') // Reset entryGatingNfdCreator
                        form.setValue('entryGatingNfdParent', '') // Reset entryGatingNfdParent

                        // Clear any errors
                        form.clearErrors('entryGatingAssets')
                        form.clearErrors('entryGatingAddress')
                        form.clearErrors('entryGatingNfdCreator')
                        form.clearErrors('entryGatingNfdParent')

                        const isNfdSegmentGating = gatingType === String(GATING_TYPE_SEGMENT_OF_NFD)

                        const gatingMinBalance = isNfdSegmentGating ? '1' : ''

                        form.setValue('gatingAssetMinBalance', gatingMinBalance) // Set/reset min balance
                        form.clearErrors('gatingAssetMinBalance') // Clear any errors for gating min balance
                      }}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select asset gating type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={String(GATING_TYPE_NONE)}>None</SelectItem>
                        <SelectItem value={String(GATING_TYPE_ASSETS_CREATED_BY)}>
                          Asset by Creator Account
                        </SelectItem>
                        <SelectItem value={String(GATING_TYPE_ASSET_ID)}>Asset ID</SelectItem>
                        <SelectItem value={String(GATING_TYPE_CREATED_BY_NFD_ADDRESSES)}>
                          Asset Created by NFD
                        </SelectItem>
                        <SelectItem value={String(GATING_TYPE_SEGMENT_OF_NFD)}>
                          NFD Segment
                        </SelectItem>
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
                <FormItem className={cn({ hidden: !isEntryGatingAddressEnabled })}>
                  <FormLabel>
                    Asset creator account
                    <InfoPopover className={infoPopoverClassName}>
                      Must hold asset created by this account to enter pool
                    </InfoPopover>
                    <span className="text-primary">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="" {...field} />
                  </FormControl>
                  <FormMessage>{errors.entryGatingAddress?.message}</FormMessage>
                </FormItem>
              )}
            />

            <div className={cn({ hidden: !isEntryGatingAssetsEnabled })}>
              {fields.map((field, index) => (
                <FormField
                  control={form.control}
                  key={field.id}
                  name={`entryGatingAssets.${index}.value`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={cn(index !== 0 && 'sr-only')}>
                        Asset ID
                        <InfoPopover className={infoPopoverClassName}>
                          Must hold asset with this ID to enter pool
                        </InfoPopover>
                        <span className="text-primary">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input {...field} />
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
                <FormItem className={cn({ hidden: !isEntryGatingNfdCreatorEnabled })}>
                  <FormLabel>
                    Asset creator NFD
                    <InfoPopover className={infoPopoverClassName}>
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
                <FormItem className={cn({ hidden: !isEntryGatingNfdParentEnabled })}>
                  <FormLabel>
                    Root/parent NFD
                    <InfoPopover className={infoPopoverClassName}>
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
                          entryGatingNfdParent,
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
                          entryGatingNfdParent,
                          showPrimaryMintNfd(
                            entryGatingNfdParent,
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
                <FormItem className={cn({ hidden: !isGatingAssetMinBalanceEnabled })}>
                  <FormLabel>
                    Minimum balance
                    <InfoPopover className={infoPopoverClassName}>
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
