import { zodResolver } from '@hookform/resolvers/zod'
import { useWallet } from '@txnlab/use-wallet-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
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
import { createGatingToken } from '@/utils/development'

const isValidAsaName = (name: string | undefined) => new TextEncoder().encode(name).length <= 32
const isValidUnitName = (name: string | undefined) => new TextEncoder().encode(name).length <= 8

const formSchema = z.object({
  assetName: z.string().optional().refine(isValidAsaName, {
    message: 'Exceeds 32 bytes.',
  }),
  unitName: z.string().optional().refine(isValidUnitName, {
    message: 'Exceeds 8 bytes.',
  }),
  total: z
    .string()
    .min(1, 'Required field.')
    .refine(
      (value) => {
        const uint64Regex = /^(0|[1-9]\d*)$/ // Matches non-negative integers in string format
        if (!uint64Regex.test(value)) return false // Must be a non-negative integer
        const n = BigInt(value) // Convert to BigInt for comparison
        return n >= 0n && n <= 2n ** 64n - 1n // Check within uint64 range
      },
      {
        message: 'Must be a valid uint64 (non-negative integer within 0 to 2^64 - 1)',
      },
    ),
  decimals: z
    .string()
    .min(1, 'Required field.')
    .refine(
      (value) => {
        const decimalsRegex = /^(0|[1-9]|1[0-9])$/ // Matches 0-19 as strings
        return decimalsRegex.test(value)
      },
      {
        message: 'Must be an integer between 0 and 19.',
      },
    ),
})

export function CreateTokenForm() {
  const [isSigning, setIsSigning] = React.useState<boolean>(false)

  const { transactionSigner, activeAddress } = useWallet()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    mode: 'onBlur',
    defaultValues: {
      assetName: '',
      unitName: '',
      total: '',
      decimals: '',
    },
  })

  const { isValid } = form.formState

  const toastIdRef = React.useRef(`toast-${Date.now()}-${Math.random()}`)
  const TOAST_ID = toastIdRef.current

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    const toastId = `${TOAST_ID}-create-token`

    try {
      setIsSigning(true)

      if (!activeAddress) {
        throw new Error('No active address')
      }

      toast.loading('Sign transaction to create token...', { id: toastId })

      const assetId = await createGatingToken(
        transactionSigner,
        activeAddress,
        BigInt(data.total),
        Number(data.decimals),
        data.assetName,
        data.unitName,
      )

      toast.success(`Token ${assetId} successfully created!`, {
        id: toastId,
        duration: 5000,
      })
    } catch (error) {
      toast.error('Failed to create token', { id: toastId })
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
        <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 max-w-3xl">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <FormField
              control={form.control}
              name="assetName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Asset Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Tether" {...field} />
                  </FormControl>
                  <FormDescription>The name of the asset. Max size is 32 bytes.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="unitName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Unit Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., USDT" {...field} />
                  </FormControl>
                  <FormDescription>
                    The name of a unit of this asset. Max size is 8 bytes.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="total"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Total <span className="text-primary">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormDescription>
                    The total number of base units of the asset to create.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="decimals"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Decimals <span className="text-primary">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormDescription>
                    The number of digits to use after the decimal point when displaying the asset.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="mt-8">
              <Button
                type="submit"
                size="lg"
                className="text-base"
                disabled={isSigning || !isValid}
              >
                Create Token
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  )
}
