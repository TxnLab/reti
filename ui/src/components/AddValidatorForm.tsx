import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet-react'
import { isAxiosError } from 'axios'
import { ArrowUpRight, Check, Monitor, MonitorCheck, WalletMinimal, X } from 'lucide-react'
import * as React from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { useDebouncedCallback } from 'use-debounce'
import { z } from 'zod'
import { addValidator, fetchValidator } from '@/api/contracts'
import { fetchNfd } from '@/api/nfd'
import { AlgoSymbol } from '@/components/AlgoSymbol'
import { AssetLookup } from '@/components/AssetLookup'
import { InfoPopover } from '@/components/InfoPopover'
import { Tooltip } from '@/components/Tooltip'
import { Button } from '@/components/ui/button'
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { GatingType } from '@/constants/gating'
import { useBlockTime } from '@/hooks/useBlockTime'
import { Asset } from '@/interfaces/algod'
import { Constraints } from '@/interfaces/validator'
import { useAuthAddress } from '@/providers/AuthAddressProvider'
import { InsufficientBalanceError } from '@/utils/balanceChecker'
import {
  getEpochLengthBlocks,
  setValidatorQueriesData,
  transformEntryGatingAssets,
} from '@/utils/contracts'
// import { validatorAutoFill } from '@/utils/development'
import { convertToBaseUnits } from '@/utils/format'
import { getNfdAppFromViteEnvironment } from '@/utils/network/getNfdConfig'
import { isValidName, trimExtension } from '@/utils/nfd'
import { cn } from '@/utils/ui'
import { entryGatingRefinement, rewardTokenRefinement, validatorSchemas } from '@/utils/validation'

const nfdAppUrl = getNfdAppFromViteEnvironment()

interface AddValidatorFormProps {
  constraints: Constraints
}

export function AddValidatorForm({ constraints }: AddValidatorFormProps) {
  const [nfdForInfoAppId, setNfdForInfoAppId] = React.useState<number>(0)
  const [isFetchingNfdForInfo, setIsFetchingNfdForInfo] = React.useState(false)
  const [nfdCreatorAppId, setNfdCreatorAppId] = React.useState<number>(0)
  const [isFetchingNfdCreator, setIsFetchingNfdCreator] = React.useState(false)
  const [nfdParentAppId, setNfdParentAppId] = React.useState<number>(0)
  const [isFetchingNfdParent, setIsFetchingNfdParent] = React.useState(false)
  const [rewardToken, setRewardToken] = React.useState<Asset | null>(null)
  const [isFetchingRewardToken, setIsFetchingRewardToken] = React.useState(false)
  const [gatingAssets, setGatingAssets] = React.useState<Array<Asset | null>>([])
  const [isFetchingGatingAssetIndex, setIsFetchingGatingAssetIndex] = React.useState<number>(-1)
  const [epochTimeframe, setEpochTimeframe] = React.useState('blocks')
  const [isSigning, setIsSigning] = React.useState(false)

  const { transactionSigner, activeAddress } = useWallet()
  const { authAddress } = useAuthAddress()

  const queryClient = useQueryClient()

  const navigate = useNavigate({ from: '/add' })

  const formSchema = z
    .object({
      owner: validatorSchemas.owner(),
      manager: validatorSchemas.manager(),
      nfdForInfo: validatorSchemas.nfdForInfo(),
      entryGatingType: validatorSchemas.entryGatingType(),
      entryGatingAddress: validatorSchemas.entryGatingAddress(),
      entryGatingAssets: validatorSchemas.entryGatingAssets(),
      entryGatingNfdCreator: validatorSchemas.entryGatingNfdCreator(),
      entryGatingNfdParent: validatorSchemas.entryGatingNfdParent(),
      gatingAssetMinBalance: validatorSchemas.gatingAssetMinBalance(),
      rewardTokenId: validatorSchemas.rewardTokenId(),
      rewardPerPayout: validatorSchemas.rewardPerPayout(),
      epochRoundLength: validatorSchemas.epochRoundLength(constraints),
      percentToValidator: validatorSchemas.percentToValidator(constraints),
      validatorCommissionAddress: validatorSchemas.validatorCommissionAddress(),
      minEntryStake: validatorSchemas.minEntryStake(constraints),
      poolsPerNode: validatorSchemas.poolsPerNode(constraints),
    })
    .superRefine((data, ctx) => rewardTokenRefinement(data, ctx, rewardToken?.params.decimals))
    .superRefine((data, ctx) => entryGatingRefinement(data, ctx, gatingAssets))

  type FormValues = z.infer<typeof formSchema>

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      owner: '',
      manager: '',
      nfdForInfo: '',
      entryGatingType: '0',
      entryGatingAddress: '',
      entryGatingAssets: [{ value: '' }],
      entryGatingNfdCreator: '',
      entryGatingNfdParent: '',
      gatingAssetMinBalance: '',
      rewardTokenId: '',
      rewardPerPayout: '',
      epochRoundLength: '',
      percentToValidator: '',
      validatorCommissionAddress: '',
      minEntryStake: '',
      poolsPerNode: '1',
    },
  })

  const { errors } = form.formState

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

  const $rewardTokenId = form.watch('rewardTokenId')
  const isRewardTokenInvalid = Number($rewardTokenId) > 0 && (isFetchingRewardToken || !rewardToken)

  const $entryGatingType = form.watch('entryGatingType')
  const $entryGatingAssets = form.watch('entryGatingAssets')
  const $nfdForInfo = form.watch('nfdForInfo')
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

      if (field === 'nfdForInfo' && nfd.owner !== activeAddress) {
        throw new Error('NFD not owned by active address')
      }

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

  const debouncedNfdForInfoCheck = useDebouncedCallback(async (value) => {
    const isValid = await form.trigger('nfdForInfo')
    if (isValid) {
      await fetchNfdAppId(value, 'nfdForInfo', setNfdForInfoAppId, setIsFetchingNfdForInfo)
    } else {
      setIsFetchingNfdForInfo(false)
    }
  }, 500)

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

  const infoPopoverClassName = 'mx-1.5 relative top-0.5 sm:mx-1 sm:top-0'

  const blockTime = useBlockTime()

  const toastIdRef = React.useRef(`toast-${Date.now()}-${Math.random()}`)
  const TOAST_ID = toastIdRef.current

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const toastId = `${TOAST_ID}-validator`

    try {
      setIsSigning(true)

      if (!activeAddress) {
        throw new Error('No active address')
      }

      toast.loading('Sign transactions to add validator...', { id: toastId })

      const rewardPerPayout = convertToBaseUnits(
        Number(values.rewardPerPayout),
        rewardToken?.params.decimals || 0,
      )

      const epochRoundLength = getEpochLengthBlocks(
        values.epochRoundLength,
        epochTimeframe,
        blockTime.ms,
      )

      const { entryGatingAssets, gatingAssetMinBalance } = transformEntryGatingAssets(
        values.entryGatingType,
        values.entryGatingAssets,
        gatingAssets,
        values.gatingAssetMinBalance,
        nfdCreatorAppId,
        nfdParentAppId,
      )

      const newValues = {
        ...values,
        rewardPerPayout: String(rewardPerPayout),
        epochRoundLength: String(epochRoundLength),
        entryGatingAssets,
        gatingAssetMinBalance,
      }

      const validatorId = await addValidator(
        newValues,
        nfdForInfoAppId,
        transactionSigner,
        activeAddress,
        authAddress,
      )

      toast.success(
        <div className="flex items-center gap-x-2">
          <MonitorCheck className="h-5 w-5 text-foreground" />
          <span>Validator {validatorId} created!</span>
        </div>,
        {
          id: toastId,
          duration: 5000,
        },
      )

      // Fetch validator data
      const newData = await fetchValidator(validatorId)

      // Seed/update query cache with new data
      setValidatorQueriesData(queryClient, newData)

      await navigate({ to: '/' })
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        toast.error('Insufficient balance', {
          id: toastId,
          description: error.toastMessage,
          duration: 5000,
        })
      } else {
        toast.error('Failed to add validator', { id: toastId })
      }
      console.error(error)
    } finally {
      setIsSigning(false)
    }
  }

  return (
    <div className="mb-12">
      <p className="text-sm text-muted-foreground">
        Fields marked with <span className="text-primary">*</span> are required
      </p>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6">
          <div className="grid gap-y-8">
            <fieldset className="grid gap-6 rounded-lg border p-6 max-w-3xl">
              <legend className="-ml-1 px-1 text-lg font-medium">Accounts</legend>

              <FormField
                control={form.control}
                name="owner"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Owner account
                      <InfoPopover className={infoPopoverClassName}>
                        Account that controls config (cold wallet recommended)
                      </InfoPopover>
                      <span className="text-primary">*</span>
                    </FormLabel>
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
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.preventDefault()
                          form.setValue('owner', activeAddress!, { shouldValidate: true })
                        }}
                      >
                        <WalletMinimal className="hidden mr-2 h-4 w-4 opacity-75 sm:inline" />
                        Autofill
                      </Button>
                    </div>
                    <FormMessage>{errors.owner?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="manager"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Manager account
                      <InfoPopover className={infoPopoverClassName}>
                        Account that triggers payouts and keyreg transactions (must sign
                        transactions)
                      </InfoPopover>
                      <span className="text-primary">*</span>
                    </FormLabel>
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
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.preventDefault()
                          form.setValue('manager', activeAddress!, { shouldValidate: true })
                        }}
                      >
                        <WalletMinimal className="hidden mr-2 h-4 w-4 opacity-75 sm:inline" />
                        Autofill
                      </Button>
                    </div>
                    <FormMessage>{errors.manager?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="validatorCommissionAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Commission account
                      <InfoPopover className={infoPopoverClassName}>
                        Account that receives validator commission payments
                      </InfoPopover>
                      <span className="text-primary">*</span>
                    </FormLabel>
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
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.preventDefault()
                          form.setValue('validatorCommissionAddress', activeAddress!, {
                            shouldValidate: true,
                          })
                        }}
                      >
                        <WalletMinimal className="hidden mr-2 h-4 w-4 opacity-75 sm:inline" />
                        Autofill
                      </Button>
                    </div>
                    <FormMessage>{errors.validatorCommissionAddress?.message}</FormMessage>
                  </FormItem>
                )}
              />
            </fieldset>

            <fieldset className="grid gap-6 rounded-lg border p-6 max-w-3xl sm:grid-cols-2 md:grid-cols-3">
              <legend className="-ml-1 px-1 text-lg font-medium">Validator Settings</legend>
              <FormField
                control={form.control}
                name="minEntryStake"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Minimum entry stake
                      <InfoPopover className={infoPopoverClassName}>
                        Minimum stake required to enter a pool
                      </InfoPopover>
                      <span className="text-primary">*</span>
                    </FormLabel>
                    <FormControl>
                      <div className="relative">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                          <AlgoSymbol verticalOffset={1} className="text-muted-foreground" />
                        </div>
                        <Input className="pl-7" placeholder="1000" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage>{errors.minEntryStake?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="epochRoundLength"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Epoch length
                      <InfoPopover className={infoPopoverClassName}>
                        Frequency of rewards payouts, in blocks. If a timeframe is selected, it will
                        be converted to blocks based on the current average block time (approx.{' '}
                        {blockTime.secs} seconds).
                      </InfoPopover>
                      <span className="text-primary">*</span>
                    </FormLabel>
                    <FormControl>
                      <div className="flex items-center">
                        <Input
                          className="rounded-r-none rounded-l-md focus:z-[2]"
                          placeholder=""
                          {...field}
                        />
                        <Select value={epochTimeframe} onValueChange={setEpochTimeframe}>
                          <FormControl>
                            <SelectTrigger className="w-[11rem] rounded-r-md rounded-l-none -ml-px">
                              <SelectValue placeholder="Select timeframe" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="blocks">Blocks</SelectItem>
                            </SelectGroup>
                            <div className="-mx-1 my-1">
                              <Separator />
                            </div>
                            <SelectGroup>
                              <SelectItem value="minutes" disabled={!blockTime}>
                                Minutes
                              </SelectItem>
                              <SelectItem value="hours" disabled={!blockTime}>
                                Hours
                              </SelectItem>
                              <SelectItem value="days" disabled={!blockTime}>
                                Days
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>
                    </FormControl>
                    <FormDescription
                      className={cn({ hidden: epochTimeframe === 'blocks' || !blockTime })}
                    >
                      Timeframes are approximate and based on{' '}
                      <strong className="font-semibold text-foreground">{blockTime.secs}s</strong>{' '}
                      avg block time
                    </FormDescription>
                    <FormMessage>{errors.epochRoundLength?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="percentToValidator"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Commission percent
                      <InfoPopover className={infoPopoverClassName}>
                        Payout percentage w/ up to four decimals (e.g., 5.0001)
                      </InfoPopover>
                      <span className="text-primary">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="5.0000" {...field} />
                    </FormControl>
                    <FormMessage>{errors.percentToValidator?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="poolsPerNode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Pools per node
                      <InfoPopover className={infoPopoverClassName}>
                        Number of pools to allow per node (max of 3 is recommended)
                      </InfoPopover>
                      <span className="text-primary">*</span>
                    </FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select number of pools" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Array.from({ length: constraints.maxPoolsPerNode }, (_, i) => i + 1).map(
                            (number) => (
                              <SelectItem key={number} value={String(number)}>
                                {number}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage>{errors.poolsPerNode?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="nfdForInfo"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>
                      Associated NFD
                      <InfoPopover className={infoPopoverClassName}>
                        NFD which the validator uses to describe their validator pool (optional)
                      </InfoPopover>
                    </FormLabel>
                    <div className="flex items-center gap-x-3">
                      <div className="flex-1 relative">
                        <FormControl>
                          <Input
                            className={cn(
                              isFetchingNfdForInfo || nfdForInfoAppId > 0 ? 'pr-10' : '',
                            )}
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
                            isFetchingNfdForInfo || nfdForInfoAppId > 0
                              ? 'opacity-100'
                              : 'opacity-0',
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
            </fieldset>

            <fieldset className="grid gap-6 rounded-lg border p-6 max-w-3xl sm:grid-cols-2">
              <legend className="-ml-1 px-1 text-lg font-medium">Reward Token</legend>
              <p className="sm:col-span-2 text-sm text-muted-foreground">
                Reward token to be paid out to stakers (optional)
              </p>
              <AssetLookup
                form={form}
                name="rewardTokenId"
                label="Asset ID"
                asset={rewardToken}
                setAsset={setRewardToken}
                isFetching={isFetchingRewardToken}
                setIsFetching={setIsFetchingRewardToken}
                errorMessage={errors.rewardTokenId?.message}
              />

              <FormField
                control={form.control}
                name="rewardPerPayout"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount per payout</FormLabel>
                    <FormControl>
                      <Input placeholder="" {...field} />
                    </FormControl>
                    <FormDescription>Enter amount in whole units (not base units)</FormDescription>
                    <FormMessage>{errors.rewardPerPayout?.message}</FormMessage>
                  </FormItem>
                )}
              />
            </fieldset>

            <fieldset className="grid gap-6 rounded-lg border p-6 max-w-3xl sm:grid-cols-2">
              <legend className="-ml-1 px-1 text-lg font-medium">Entry Gating</legend>
              <p className="sm:col-span-2 text-sm text-muted-foreground">
                Require stakers to hold a qualified asset to enter pool (optional)
              </p>
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
                          <InfoPopover className={infoPopoverClassName}>
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
                <FormMessage className="mt-2">
                  {errors.entryGatingAssets?.root?.message}
                </FormMessage>
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
                  <FormItem className={cn({ hidden: !showParentNfdField })}>
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
                      <InfoPopover className={infoPopoverClassName}>
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
            </fieldset>
          </div>
          <div className="flex justify-between mt-12">
            {/* <Button
              variant="outline"
              onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                event.preventDefault()
                form.reset(validatorAutoFill(activeAddress as string))
              }}
            >
              Autofill
            </Button> */}
            <Button
              type="submit"
              size="lg"
              className="w-full text-base sm:w-auto"
              disabled={
                isSigning ||
                isRewardTokenInvalid ||
                isFetchingNfdForInfo ||
                isFetchingNfdCreator ||
                isFetchingNfdParent
              }
            >
              <Monitor className="mr-2 h-5 w-5" />
              Add Validator
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}
