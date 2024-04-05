import * as algokit from '@algorandfoundation/algokit-utils'
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { isAxiosError } from 'axios'
import { Check, MonitorCheck } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { useDebouncedCallback } from 'use-debounce'
import { z } from 'zod'
import { makeSimulateValidatorClient, makeValidatorClient } from '@/api/contracts'
import { fetchNfd } from '@/api/nfd'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { Constraints, ValidatorConfig } from '@/interfaces/validator'
import { getAddValidatorFormSchema } from '@/utils/contracts'
// import { validatorAutoFill } from '@/utils/development'
import { getAlgodConfigFromViteEnvironment } from '@/utils/network/getAlgoClientConfigs'
import { cn } from '@/utils/ui'

const algodConfig = getAlgodConfigFromViteEnvironment()
const algodClient = algokit.getAlgoClient({
  server: algodConfig.server,
  port: algodConfig.port,
  token: algodConfig.token,
})

interface AddValidatorFormProps {
  constraints: Constraints
}

export function AddValidatorForm({ constraints }: AddValidatorFormProps) {
  const [nfdAppId, setNfdAppId] = React.useState<number>(0)
  const [isFetchingAppId, setIsFetchingAppId] = React.useState(false)
  const [isSigning, setIsSigning] = React.useState(false)

  const { transactionSigner, activeAddress } = useWallet()

  const navigate = useNavigate({ from: '/add' })

  const formSchema = getAddValidatorFormSchema(constraints)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    mode: 'onBlur',
    defaultValues: {
      owner: '',
      manager: '',
      nfdForInfo: '',
      entryGatingType: '',
      entryGatingValue: '',
      gatingAssetMinBalance: '',
      rewardTokenId: '',
      rewardPerPayout: '',
      payoutEveryXMins: '',
      percentToValidator: '',
      validatorCommissionAddress: '',
      minEntryStake: '',
      maxAlgoPerPool: '',
      poolsPerNode: '',
      sunsettingOn: '',
      sunsettingTo: '',
    },
  })

  const { errors, isValid } = form.formState

  const fetchNfdForInfo = async (value: string) => {
    setIsFetchingAppId(true)

    try {
      const nfd = await fetchNfd(value, { view: 'brief' })

      // If we have an app id, clear error if it exists
      form.clearErrors('nfdForInfo')
      setNfdAppId(nfd.appID!)
    } catch (error) {
      if (isAxiosError(error) && error.response) {
        if (error.response.status !== 404) {
          console.error(error.message)
        }
      } else {
        // Handle non-HTTP errors
        console.error(error)
      }
      form.setError('nfdForInfo', { type: 'manual', message: 'NFD app id not found' })
    } finally {
      setIsFetchingAppId(false)
    }
  }

  const debouncedCheck = useDebouncedCallback(async (value) => {
    const isValid = await form.trigger('nfdForInfo')
    if (isValid) {
      fetchNfdForInfo(value)
    }
  }, 500)

  const toastIdRef = React.useRef(`toast-${Date.now()}-${Math.random()}`)
  const TOAST_ID = toastIdRef.current

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const toastId = `${TOAST_ID}-validator`

    try {
      setIsSigning(true)

      if (!activeAddress) {
        throw new Error('No active address')
      }

      const validatorClient = makeValidatorClient(transactionSigner, activeAddress)

      toast.loading('Sign transactions to add validator...', { id: toastId })

      const validatorAppRef = await validatorClient.appClient.getAppReference()

      const [validatorMbr] = (
        await validatorClient
          .compose()
          .getMbrAmounts(
            {},
            {
              sender: {
                addr: activeAddress as string,
                signer: algosdk.makeEmptyTransactionSigner(),
              },
            },
          )
          .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
      ).returns![0]

      const suggestedParams = await algodClient.getTransactionParams().do()

      const payValidatorMbr = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: activeAddress,
        to: validatorAppRef.appAddress,
        amount: Number(validatorMbr),
        suggestedParams,
      })

      const validatorConfig: ValidatorConfig = {
        id: 0, // id not known yet
        owner: values.owner,
        manager: values.manager,
        nfdForInfo: nfdAppId,
        entryGatingType: 0,
        entryGatingValue: new Uint8Array(32),
        gatingAssetMinBalance: BigInt(values.gatingAssetMinBalance || 0),
        rewardTokenId: Number(values.rewardTokenId || 0),
        rewardPerPayout: BigInt(values.rewardPerPayout || 0),
        payoutEveryXMins: Number(values.payoutEveryXMins),
        percentToValidator: Number(values.percentToValidator) * 10000,
        validatorCommissionAddress: values.validatorCommissionAddress,
        minEntryStake: BigInt(AlgoAmount.Algos(Number(values.minEntryStake)).microAlgos),
        maxAlgoPerPool: BigInt(AlgoAmount.Algos(Number(values.maxAlgoPerPool)).microAlgos),
        poolsPerNode: Number(values.poolsPerNode),
        sunsettingOn: Number(values.sunsettingOn || 0),
        sunsettingTo: Number(values.sunsettingTo || 0),
      }

      const simulateValidatorClient = makeSimulateValidatorClient(activeAddress)

      const simulateResult = await simulateValidatorClient
        .compose()
        .addValidator(
          {
            mbrPayment: {
              transaction: payValidatorMbr,
              signer: { addr: activeAddress, signer: algosdk.makeEmptyTransactionSigner() },
            },
            nfdName: values.nfdForInfo || '',
            config: [
              validatorConfig.id,
              validatorConfig.owner,
              validatorConfig.manager,
              validatorConfig.nfdForInfo,
              validatorConfig.entryGatingType,
              validatorConfig.entryGatingValue,
              validatorConfig.gatingAssetMinBalance,
              validatorConfig.rewardTokenId,
              validatorConfig.rewardPerPayout,
              validatorConfig.payoutEveryXMins,
              validatorConfig.percentToValidator,
              validatorConfig.validatorCommissionAddress,
              validatorConfig.minEntryStake,
              validatorConfig.maxAlgoPerPool,
              validatorConfig.poolsPerNode,
              validatorConfig.sunsettingOn,
              validatorConfig.sunsettingTo,
            ],
          },
          { sendParams: { fee: AlgoAmount.MicroAlgos(240_000) } },
        )
        .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })

      payValidatorMbr.group = undefined

      // @todo: switch to Joe's new method(s)
      const feesAmount = AlgoAmount.MicroAlgos(
        1000 *
          Math.floor(
            ((simulateResult.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700,
          ),
      )

      const result = await validatorClient
        .compose()
        .addValidator(
          {
            mbrPayment: {
              transaction: payValidatorMbr,
              signer: {
                signer: transactionSigner,
                addr: activeAddress,
              } as TransactionSignerAccount,
            },
            nfdName: values.nfdForInfo || '',
            config: [
              validatorConfig.id,
              validatorConfig.owner,
              validatorConfig.manager,
              validatorConfig.nfdForInfo,
              validatorConfig.entryGatingType,
              validatorConfig.entryGatingValue,
              validatorConfig.gatingAssetMinBalance,
              validatorConfig.rewardTokenId,
              validatorConfig.rewardPerPayout,
              validatorConfig.payoutEveryXMins,
              validatorConfig.percentToValidator,
              validatorConfig.validatorCommissionAddress,
              validatorConfig.minEntryStake,
              validatorConfig.maxAlgoPerPool,
              validatorConfig.poolsPerNode,
              validatorConfig.sunsettingOn,
              validatorConfig.sunsettingTo,
            ],
          },
          { sendParams: { fee: feesAmount } },
        )
        .execute({ populateAppCallResources: true })

      const validatorId = Number(result.returns![0])

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

      navigate({ to: '/' })
    } catch (error) {
      toast.error('Failed to create validator', { id: toastId })
      console.error(error)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card className="w-full max-w-[600px]">
          <CardHeader>
            <CardTitle>New validator configuration</CardTitle>
            <CardDescription>
              Fields marked with <span className="text-red-500">*</span> are required
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid w-full items-center gap-8">
              <FormField
                control={form.control}
                name="owner"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Owner address <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input className="font-mono dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormDescription>
                      Account that controls config (cold wallet recommended)
                    </FormDescription>
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
                      Manager address <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input className="font-mono dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormDescription>
                      Account that triggers payouts and keyreg transactions (must sign transactions)
                    </FormDescription>
                    <FormMessage>{errors.manager?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="nfdForInfo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Associated NFD</FormLabel>
                    <div className="relative">
                      <FormControl>
                        <Input
                          className={cn(
                            'dark:bg-black/10',
                            isFetchingAppId || nfdAppId > 0 ? 'pr-10' : '',
                          )}
                          placeholder=""
                          autoComplete="new-password"
                          spellCheck="false"
                          {...field}
                          onChange={(e) => {
                            field.onChange(e) // Inform react-hook-form of the change
                            setNfdAppId(0) // Reset NFD app id
                            debouncedCheck(e.target.value) // Perform debounced validation
                          }}
                        />
                      </FormControl>
                      <div
                        className={cn(
                          isFetchingAppId || nfdAppId > 0 ? 'opacity-100' : 'opacity-0',
                          'pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3',
                        )}
                      >
                        {isFetchingAppId ? (
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
                        ) : nfdAppId ? (
                          <Check className="h-5 w-5 text-green-500" />
                        ) : null}
                      </div>
                    </div>

                    <FormDescription>
                      NFD which the validator uses to describe their validator pool (optional)
                    </FormDescription>
                    <FormMessage>{errors.nfdForInfo?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="gatingAssetMinBalance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Creator NFT Minimum Balance</FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormDescription>
                      Minimum required balance of the asset described above
                    </FormDescription>
                    <FormMessage>{errors.gatingAssetMinBalance?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="rewardTokenId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reward Token ID</FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormMessage>{errors.rewardTokenId?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="rewardPerPayout"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reward Token Amount Per Payout</FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormMessage>{errors.rewardPerPayout?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="payoutEveryXMins"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Epoch length <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormDescription>Frequency of rewards payouts (in minutes)</FormDescription>
                    <FormMessage>{errors.payoutEveryXMins?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="percentToValidator"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Validator commission percent <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormDescription>
                      Payout percentage w/ up to four decimals (e.g., 5.0001)
                    </FormDescription>
                    <FormMessage>{errors.percentToValidator?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="validatorCommissionAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Commission address <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input className="font-mono dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormDescription>
                      Account that receives validator commission payments
                    </FormDescription>
                    <FormMessage>{errors.validatorCommissionAddress?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="minEntryStake"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Minimum entry stake <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormDescription>Minimum stake required to enter a pool</FormDescription>
                    <FormMessage>{errors.minEntryStake?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="maxAlgoPerPool"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Maximum total stake</FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormDescription>
                      Maximum stake allowed per pool (to keep under incentive limits)
                    </FormDescription>
                    <FormMessage>{errors.maxAlgoPerPool?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="poolsPerNode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Pools per node <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormDescription>
                      Number of pools to allow per node (max of 3 is recommended)
                    </FormDescription>
                    <FormMessage>{errors.poolsPerNode?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sunsettingOn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sunset Time</FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormDescription>Timestamp when validator will sunset</FormDescription>
                    <FormMessage>{errors.sunsettingOn?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sunsettingTo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sunset To (Validator ID)</FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormDescription>
                      Validator ID that the validator is moving to (if known)
                    </FormDescription>
                    <FormMessage>{errors.sunsettingTo?.message}</FormMessage>
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            {/* <Button
              variant="outline"
              onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                event.preventDefault()
                form.reset(validatorAutoFill(activeAddress as string))
              }}
            >
              Autofill
            </Button> */}
            <Button type="submit" disabled={isSigning || !isValid}>
              Add Validator
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  )
}
