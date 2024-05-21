import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { linkPoolToNfd } from '@/api/contracts'
import { NfdLookup } from '@/components/NfdLookup'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Form } from '@/components/ui/form'
import { isValidName } from '@/utils/nfd'

interface LinkPoolToNfdModalProps {
  poolId: number
  poolAppId: number
  disabled?: boolean
  className?: string
}

export function LinkPoolToNfdModal({
  poolId,
  poolAppId,
  disabled = false,
  className = '',
}: LinkPoolToNfdModalProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [nfdAppId, setNfdAppId] = React.useState<number>(0)
  const [isFetchingNfd, setIsFetchingNfd] = React.useState(false)
  const [isSigning, setIsSigning] = React.useState<boolean>(false)

  const queryClient = useQueryClient()
  const { transactionSigner, activeAddress } = useWallet()

  const formSchema = z.object({
    nfdName: z.string().refine((val) => val === '' || isValidName(val), {
      message: 'NFD name is invalid',
    }),
  })

  const defaultValues = {
    nfdName: '',
  }

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues,
  })

  const { errors, isValid } = form.formState
  const $nfdName = form.watch('nfdName')

  const handleResetForm = () => {
    form.reset(defaultValues)
    form.clearErrors()
    setIsSigning(false)
    setNfdAppId(0)
  }

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)

    if (!open) {
      setTimeout(() => handleResetForm(), 500)
    } else {
      handleResetForm()
    }
  }

  const toastIdRef = React.useRef(`toast-${Date.now()}-${Math.random()}`)
  const TOAST_ID = toastIdRef.current

  const handleLinkNfd = async (data: z.infer<typeof formSchema>) => {
    const toastId = `${TOAST_ID}-link-nfd`

    if (!activeAddress) {
      throw new Error('No active address')
    }

    if (!poolId || !poolAppId) {
      throw new Error('No pool found')
    }

    try {
      setIsSigning(true)
      toast.loading(`Sign transaction to link ${data.nfdName} to Pool ${poolId}...`, {
        id: toastId,
      })

      await linkPoolToNfd(poolAppId, data.nfdName, nfdAppId, transactionSigner, activeAddress)

      toast.success(`Pool ${poolId} successfully linked to ${data.nfdName}!`, {
        id: toastId,
        duration: 5000,
      })

      const poolAppAddress = algosdk.getApplicationAddress(poolAppId)
      queryClient.invalidateQueries({ queryKey: ['nfd-lookup', poolAppAddress] })

      handleOpenChange(false)
    } catch (error) {
      toast.error('Linking NFD to pool failed', { id: toastId })
      console.error(error)
    } finally {
      setIsSigning(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className={className} disabled={disabled}>
          Link NFD
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link Pool to NFD</DialogTitle>
          <DialogDescription>Link the Pool {poolId} contract account to an NFD</DialogDescription>
        </DialogHeader>
        <div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleLinkNfd)}>
              <NfdLookup
                form={form}
                name="nfdName"
                nfdAppId={nfdAppId}
                setNfdAppId={setNfdAppId}
                isFetchingNfd={isFetchingNfd}
                setIsFetchingNfd={setIsFetchingNfd}
                watchValue={$nfdName}
                errorMessage={errors.nfdName?.message}
                activeAddress={activeAddress}
                validateOwner
                warnVerified
              />

              <DialogFooter className="mt-4">
                <Button
                  type="submit"
                  disabled={isSigning || !isValid || isFetchingNfd || !!errors.nfdName?.message}
                >
                  Link Pool to NFD
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
