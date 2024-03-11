import * as algokit from '@algorandfoundation/algokit-utils'
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { zodResolver } from '@hookform/resolvers/zod'
import { useWallet } from '@txnlab/use-wallet'
import algosdk from 'algosdk'
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { ValidatorRegistryClient } from '@/contracts/ValidatorRegistryClient'
import { getAlgodConfigFromViteEnvironment } from '@/utils/network/getAlgoClientConfigs'
import { isValidName } from '@/utils/nfd'
import {
  getNfdRegistryAppIdFromViteEnvironment,
  getRetiAppIdFromViteEnvironment,
} from '@/utils/env'

const formSchema = z
  .object({
    Owner: z.string().refine((val) => algosdk.isValidAddress(val), {
      message: 'Owner address is invalid',
    }),
    Manager: z.string().refine((val) => algosdk.isValidAddress(val), {
      message: 'Manager address is invalid',
    }),
    NFDForInfo: z
      .string()
      .refine((val) => val === '' || isValidName(val), {
        message: 'NFD name is invalid',
      })
      .optional(),
    MustHoldCreatorNFT: z
      .string()
      .refine((val) => val === '' || algosdk.isValidAddress(val), {
        message: 'Manager address is invalid',
      })
      .optional(),
    CreatorNFTMinBalance: z
      .string()
      .refine((val) => val === '' || Number(val) >= 1, {
        message: 'Minimum balance must be at least 1',
      })
      .optional(),
    RewardTokenID: z
      .string()
      .refine((val) => val === '' || Number(val) >= 1, {
        message: 'Reward token ID is invalid',
      })
      .optional(),
    RewardPerPayout: z
      .string()
      .refine((val) => val === '' || Number(val) >= 1, {
        message: 'Reward amount per payout is invalid',
      })
      .optional(),
    PayoutEveryXMins: z.string().refine((val) => Number(val) >= 1, {
      message: 'Payout frequency must be at least 1 minute',
    }),
    PercentToValidator: z
      .string()
      .refine((val) => val !== '' && Number(val) >= 0 && Number(val) <= 100, {
        message: 'Payout percentage must be between 0 and 100',
      }),
    ValidatorCommissionAddress: z.string().refine((val) => algosdk.isValidAddress(val), {
      message: 'Commission address is invalid',
    }),
    MinEntryStake: z.string().refine((val) => Number(val) >= 1, {
      message: 'Minimum stake must be at least 1 ALGO',
    }),
    MaxAlgoPerPool: z.string().refine((val) => Number(val) >= 1, {
      message: 'Maximum stake must be at least 1 ALGO',
    }),
    PoolsPerNode: z.string().refine((val) => Number(val) >= 1 && Number(val) <= 4, {
      message: 'Pools per node must be at least 1',
    }),
  })
  .required()

const algodConfig = getAlgodConfigFromViteEnvironment()
const algodClient = algokit.getAlgoClient({
  server: algodConfig.server,
  port: algodConfig.port,
  token: algodConfig.token,
})

const RETI_APP_ID = getRetiAppIdFromViteEnvironment()
const NFD_REGISTRY_APP_ID = getNfdRegistryAppIdFromViteEnvironment()

export function AddForm() {
  const { signer, activeAddress } = useWallet()

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
    },
  })

  const { errors } = form.formState

  const toastIdRef = React.useRef(`toast-${Date.now()}-${Math.random()}`)
  const TOAST_ID = toastIdRef.current

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
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

      toast.loading('Sign transactions to add validator...', { id: `${TOAST_ID}-validator` })

      const validatorAppRef = await validatorClient.appClient.getAppReference()

      const validatorConfig = {
        Owner: values.Owner,
        Manager: values.Manager,
        NFDForInfo: BigInt(values.NFDForInfo),
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
          ],
        })
        .execute({ populateAppCallResources: true })

      const validatorId = Number(results.returns![0])

      toast.success(`Validator ID ${validatorId} created!`, {
        id: `${TOAST_ID}-validator`,
        duration: 5000,
      })
    } catch (error) {
      toast.error('Failed to create validator', { id: `${TOAST_ID}-validator` })
      console.error(error)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card className="w-full max-w-[600px]">
          <CardHeader>
            <CardTitle>Create a new validator</CardTitle>
            <CardDescription>Define validator configuration below</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid w-full items-center gap-4">
              <FormField
                control={form.control}
                name="Owner"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Owner address</FormLabel>
                    <FormControl>
                      <Input className="font-mono dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormMessage>{errors.Owner?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="Manager"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Manager address</FormLabel>
                    <FormControl>
                      <Input className="font-mono dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormMessage>{errors.Manager?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="NFDForInfo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Associated NFD <span className="ml-2 text-xs text-white/50">optional</span>
                    </FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormMessage>{errors.NFDForInfo?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="MustHoldCreatorNFT"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Must Hold Creator NFT{' '}
                      <span className="ml-2 text-xs text-white/50">optional</span>
                    </FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormMessage>{errors.NFDForInfo?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="CreatorNFTMinBalance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Creator NFT Minimum Balance{' '}
                      <span className="ml-2 text-xs text-white/50">optional</span>
                    </FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormMessage>{errors.NFDForInfo?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="RewardTokenID"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Reward Token ID <span className="ml-2 text-xs text-white/50">optional</span>
                    </FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormMessage>{errors.NFDForInfo?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="RewardPerPayout"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Reward Token Amount Per Payout{' '}
                      <span className="ml-2 text-xs text-white/50">optional</span>
                    </FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormMessage>{errors.NFDForInfo?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="PayoutEveryXMins"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payout frequency (minutes)</FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormMessage>{errors.PayoutEveryXMins?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="PercentToValidator"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payout percentage to validator</FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormMessage>{errors.PercentToValidator?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="ValidatorCommissionAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Commission address</FormLabel>
                    <FormControl>
                      <Input className="font-mono dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormMessage>{errors.ValidatorCommissionAddress?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="MinEntryStake"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Minimum stake</FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormMessage>{errors.MinEntryStake?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="MaxAlgoPerPool"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Maximum stake</FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormMessage>{errors.MaxAlgoPerPool?.message}</FormMessage>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="PoolsPerNode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Maximum pools per node</FormLabel>
                    <FormControl>
                      <Input className="dark:bg-black/10" placeholder="" {...field} />
                    </FormControl>
                    <FormMessage>{errors.PoolsPerNode?.message}</FormMessage>
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
