import * as algokit from '@algorandfoundation/algokit-utils'
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet'
import algosdk from 'algosdk'
import { MonitorCheck } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
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
import { ValidatorRegistryClient } from '@/contracts/ValidatorRegistryClient'
import { Constraints } from '@/interfaces/validator'
import { getAddValidatorFormSchema } from '@/utils/contracts'
import {
  getNfdRegistryAppIdFromViteEnvironment,
  getRetiAppIdFromViteEnvironment,
} from '@/utils/env'
import { getAlgodConfigFromViteEnvironment } from '@/utils/network/getAlgoClientConfigs'

const algodConfig = getAlgodConfigFromViteEnvironment()
const algodClient = algokit.getAlgoClient({
  server: algodConfig.server,
  port: algodConfig.port,
  token: algodConfig.token,
})

const RETI_APP_ID = getRetiAppIdFromViteEnvironment()
const NFD_REGISTRY_APP_ID = getNfdRegistryAppIdFromViteEnvironment()

interface AddValidatorFormProps {
  constraints: Constraints
}

export function AddValidatorForm({ constraints }: AddValidatorFormProps) {
  const { signer, activeAddress } = useWallet()

  const navigate = useNavigate({ from: '/add' })

  const formSchema = getAddValidatorFormSchema(constraints)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      Owner: '',
      Manager: '',
      NFDForInfo: '',
      MustHoldCreatorNFT: '',
      CreatorNFTMinBalance: '',
      RewardTokenID: '',
      RewardPerPayout: '',
      PayoutEveryXMins: '',
      PercentToValidator: '',
      ValidatorCommissionAddress: '',
      MinEntryStake: '',
      MaxAlgoPerPool: '',
      PoolsPerNode: '',
      SunsettingOn: '',
      SunsettingTo: '',
    },
  })

  const { errors } = form.formState

  const toastIdRef = React.useRef(`toast-${Date.now()}-${Math.random()}`)
  const TOAST_ID = toastIdRef.current

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const toastId = `${TOAST_ID}-validator`

    try {
      if (!activeAddress) {
        throw new Error('No active address')
      }

      const validatorClient = new ValidatorRegistryClient(
        {
          sender: { signer, addr: activeAddress } as TransactionSignerAccount,
          resolveBy: 'id',
          id: RETI_APP_ID,
          deployTimeParams: {
            NFDRegistryAppID: NFD_REGISTRY_APP_ID,
          },
        },
        algodClient,
      )

      toast.loading('Sign transactions to add validator...', { id: toastId })

      const validatorAppRef = await validatorClient.appClient.getAppReference()

      const validatorConfig = {
        Owner: values.Owner,
        Manager: values.Manager,
        NFDForInfo: BigInt(values.NFDForInfo || 0),
        MustHoldCreatorNFT:
          values.MustHoldCreatorNFT || 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
        CreatorNFTMinBalance: BigInt(values.CreatorNFTMinBalance || 0),
        RewardTokenID: BigInt(values.RewardTokenID || 0),
        RewardPerPayout: BigInt(values.RewardPerPayout || 0),
        PayoutEveryXMins: Number(values.PayoutEveryXMins),
        PercentToValidator: Number(values.PercentToValidator) * 10000,
        ValidatorCommissionAddress: values.ValidatorCommissionAddress,
        MinEntryStake: BigInt(AlgoAmount.Algos(Number(values.MinEntryStake)).microAlgos),
        MaxAlgoPerPool: BigInt(AlgoAmount.Algos(Number(values.MaxAlgoPerPool)).microAlgos),
        PoolsPerNode: Number(values.PoolsPerNode),
        SunsettingOn: BigInt(values.SunsettingOn || 0),
        SunsettingTo: BigInt(values.SunsettingTo || 0),
      }

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

      const results = await validatorClient
        .compose()
        .addValidator({
          mbrPayment: {
            transaction: payValidatorMbr,
            signer: { signer, addr: activeAddress } as TransactionSignerAccount,
          },
          nfdName: '',
          config: [
            BigInt(0), // ID not known yet
            validatorConfig.Owner,
            validatorConfig.Manager,
            validatorConfig.NFDForInfo,
            validatorConfig.MustHoldCreatorNFT,
            validatorConfig.CreatorNFTMinBalance,
            validatorConfig.RewardTokenID,
            validatorConfig.RewardPerPayout,
            validatorConfig.PayoutEveryXMins,
            validatorConfig.PercentToValidator,
            validatorConfig.ValidatorCommissionAddress,
            validatorConfig.MinEntryStake,
            validatorConfig.MaxAlgoPerPool,
            validatorConfig.PoolsPerNode,
            validatorConfig.SunsettingOn,
            validatorConfig.SunsettingTo,
          ],
        })
        .execute({ populateAppCallResources: true })

      const validatorId = Number(results.returns![0])

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

      navigate({ to: '/dashboard' })
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
                name="Owner"
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
                    <FormMessage>{errors.Owner?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="Manager"
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
                    <FormMessage>{errors.Manager?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="NFDForInfo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Associated NFD</FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormDescription>
                      NFD which the validator uses to describe their validator pool (optional)
                    </FormDescription>
                    <FormMessage>{errors.NFDForInfo?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="MustHoldCreatorNFT"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Must Hold Creator NFT</FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormDescription>
                      Stakers will be required to hold an asset created by this account (optional)
                    </FormDescription>
                    <FormMessage>{errors.MustHoldCreatorNFT?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="CreatorNFTMinBalance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Creator NFT Minimum Balance</FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormDescription>
                      Minimum required balance of the asset described above
                    </FormDescription>
                    <FormMessage>{errors.CreatorNFTMinBalance?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="RewardTokenID"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reward Token ID</FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormMessage>{errors.RewardTokenID?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="RewardPerPayout"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reward Token Amount Per Payout</FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormMessage>{errors.RewardPerPayout?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="PayoutEveryXMins"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Epoch length <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormDescription>Frequency of rewards payouts (in minutes)</FormDescription>
                    <FormMessage>{errors.PayoutEveryXMins?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="PercentToValidator"
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
                    <FormMessage>{errors.PercentToValidator?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="ValidatorCommissionAddress"
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
                    <FormMessage>{errors.ValidatorCommissionAddress?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="MinEntryStake"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Minimum entry stake <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormDescription>Minimum stake required to enter a pool</FormDescription>
                    <FormMessage>{errors.MinEntryStake?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="MaxAlgoPerPool"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Maximum total stake <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormDescription>
                      Maximum stake allowed per pool (to keep under incentive limits)
                    </FormDescription>
                    <FormMessage>{errors.MaxAlgoPerPool?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="PoolsPerNode"
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
                    <FormMessage>{errors.PoolsPerNode?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="SunsettingOn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sunset Time</FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormDescription>Timestamp when validator will sunset</FormDescription>
                    <FormMessage>{errors.SunsettingOn?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="SunsettingTo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sunset To (Validator ID)</FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormDescription>
                      Validator ID that the validator is moving to (if known)
                    </FormDescription>
                    <FormMessage>{errors.SunsettingTo?.message}</FormMessage>
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            {/* <Button
              variant="outline"
              size="default"
              onClick={() => {
                form.reset({
                  Owner: 'DWKDZLYPN2W5WWISQG76RS3DGQPJ67IFKNIEGGXKWVQTDTTYCT5GBG2DYE',
                  Manager: 'DWKDZLYPN2W5WWISQG76RS3DGQPJ67IFKNIEGGXKWVQTDTTYCT5GBG2DYE',
                  PayoutEveryXMins: (60 * 24).toString(),
                  PercentToValidator: '3.4464',
                  ValidatorCommissionAddress:
                    'PUKGRD4XHCTSBCRK6LAUALDMAKPCNG4PFQY2HQH5XFCJ5U6YU4ZSH4SDBY',
                  MinEntryStake: '1000',
                  MaxAlgoPerPool: '20000000',
                  PoolsPerNode: '3',
                })
              }}
            >
              Autofill
            </Button> */}
            <Button type="submit" size="default">
              Add Validator
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  )
}
