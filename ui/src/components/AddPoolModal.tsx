import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ProgressBar } from '@tremor/react'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { fetchAccountInformation } from '@/api/algod'
import {
  addStakingPool,
  fetchValidator,
  initStakingPoolStorage,
  linkPoolToNfd,
} from '@/api/contracts'
import { mbrQueryOptions, poolAssignmentQueryOptions } from '@/api/queries'
import { AlgoDisplayAmount } from '@/components/AlgoDisplayAmount'
import { NfdLookup } from '@/components/NfdLookup'
import { NodeSelect } from '@/components/NodeSelect'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Nfd } from '@/interfaces/nfd'
import { NodePoolAssignmentConfig, Validator, ValidatorPoolKey } from '@/interfaces/validator'
import { BalanceChecker, InsufficientBalanceError } from '@/utils/balanceChecker'
import {
  findFirstAvailableNode,
  processNodePoolAssignment,
  setValidatorQueriesData,
} from '@/utils/contracts'
import { formatAlgoAmount } from '@/utils/format'
import { isValidName } from '@/utils/nfd'
import { cn } from '@/utils/ui'

interface AddPoolModalProps {
  validator: Validator | null
  setValidator: React.Dispatch<React.SetStateAction<Validator | null>>
  poolAssignment?: NodePoolAssignmentConfig
}

export function AddPoolModal({
  validator,
  setValidator,
  poolAssignment: poolAssignmentProp,
}: AddPoolModalProps) {
  const [isSigning, setIsSigning] = React.useState<boolean>(false)
  const [progress, setProgress] = React.useState<number>(0)
  const [currentStep, setCurrentStep] = React.useState<number>(1)
  const [poolKey, setPoolKey] = React.useState<ValidatorPoolKey | null>(null)
  const [isInitMbrError, setIsInitMbrError] = React.useState<string | undefined>(undefined)
  const [nfdToLink, setNfdToLink] = React.useState<Nfd | null>(null)
  const [isFetchingNfdToLink, setIsFetchingNfdToLink] = React.useState(false)

  const isLocalnet = import.meta.env.VITE_ALGOD_NETWORK === 'localnet'

  const queryClient = useQueryClient()
  const { transactionSigner, activeAddress } = useWallet()

  const accountInfoQuery = useQuery({
    queryKey: ['account-info', activeAddress],
    queryFn: () => fetchAccountInformation(activeAddress!),
    enabled: !!activeAddress && !!validator, // wait until modal is open
  })

  const { amount = 0, 'min-balance': minBalance = 0 } = accountInfoQuery.data || {}

  const availableBalance = Math.max(0, amount - minBalance)

  const mbrQuery = useQuery(mbrQueryOptions)
  const { poolMbr = 0, poolInitMbr = 0 } = mbrQuery.data || {}

  const assignmentQuery = useQuery(poolAssignmentQueryOptions(validator?.id || '', !!validator))
  const poolAssignment = assignmentQuery.data || poolAssignmentProp

  const nodesInfo = React.useMemo(() => {
    if (!poolAssignment || !validator) {
      return []
    }
    return processNodePoolAssignment(poolAssignment, validator?.config.poolsPerNode)
  }, [poolAssignment, validator?.config.poolsPerNode])

  const defaultNodeNum = React.useMemo(() => {
    if (!validator?.config.poolsPerNode || !poolAssignment) {
      return '1'
    }
    const nodeNum = findFirstAvailableNode(poolAssignment, validator.config.poolsPerNode)
    return nodeNum?.toString() || '1'
  }, [poolAssignment, validator?.config.poolsPerNode])

  const formSchema = z.object({
    nodeNum: z
      .string()
      .refine((val) => val !== '', {
        message: 'Required field',
      })
      .refine(() => availableBalance >= poolMbr, {
        message: `Insufficient balance: ${formatAlgoAmount(poolMbr)} ALGO required`,
      })
      .refine(
        (val) => {
          if (!validator) return false
          return nodesInfo.some((node) => node.index === Number(val) && node.availableSlots > 0)
        },
        {
          message: 'Node has no available slots',
        },
      ),
    nfdToLink: z.string().refine((val) => val === '' || isValidName(val), {
      message: 'NFD name is invalid',
    }),
  })

  const defaultValues = {
    nodeNum: defaultNodeNum,
    nfdToLink: '',
  }

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues,
  })

  const { errors } = form.formState

  const nodeNum = form.watch('nodeNum')
  const $nfdToLink = form.watch('nfdToLink')

  React.useEffect(() => {
    if (validator !== null && currentStep == 1 && nodeNum !== '' && !errors.nodeNum) {
      setProgress(33)
    }
  }, [validator, currentStep, nodeNum, errors.nodeNum])

  React.useEffect(() => {
    form.setValue('nodeNum', defaultNodeNum)
  }, [defaultNodeNum, form.setValue])

  const handleResetForm = () => {
    form.reset(defaultValues)
    form.clearErrors()
    setProgress(0)
    setCurrentStep(1)
    setPoolKey(null)
    setIsSigning(false)
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      if (validator) setValidator(null)
      setTimeout(() => handleResetForm(), 500)
    } else {
      handleResetForm()
    }
  }

  const toastIdRef = React.useRef(`toast-${Date.now()}-${Math.random()}`)
  const TOAST_ID = toastIdRef.current

  const handleCreatePool = async (data: z.infer<typeof formSchema>) => {
    const toastId = `${TOAST_ID}-add-pool`

    try {
      if (!activeAddress) {
        throw new Error('No active address')
      }

      if (!validator) {
        throw new Error('No validator found')
      }

      if (!poolMbr) {
        throw new Error('No MBR data found')
      }

      // Required balance for step 1
      const createPoolRequiredBalance = poolMbr + 1000 + 2000

      // Required balance for step 2
      const mbrAmount =
        validator.config.rewardTokenId !== 0 && validator.state.numPools === 0
          ? poolInitMbr + 100_000
          : poolInitMbr
      const initStorageRequiredBalance = mbrAmount + 1000 + 3000

      // Check balance for both steps
      const requiredBalance = createPoolRequiredBalance + initStorageRequiredBalance
      await BalanceChecker.check(activeAddress, requiredBalance, 'Add staking pool')

      toast.loading('Sign transactions to add staking pool...', { id: toastId })

      setIsSigning(true)

      const stakingPoolKey = await addStakingPool(
        validator!.id,
        Number(data.nodeNum),
        poolMbr,
        transactionSigner,
        activeAddress,
      )
      setPoolKey(stakingPoolKey)

      toast.success(`Staking pool ${stakingPoolKey.poolId} created!`, {
        id: toastId,
        duration: 5000,
      })

      // Refetch account info to get new available balance for MBR payment
      await accountInfoQuery.refetch()

      setProgress(68)
      setCurrentStep(2)
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        toast.error('Insufficient balance', {
          id: toastId,
          description: error.toastMessage,
          duration: 5000,
        })
        console.error(error)
      } else {
        toast.error('Failed to create staking pool', { id: toastId })
        console.error(error)
      }
      handleOpenChange(false)
    } finally {
      setIsSigning(false)
    }
  }

  const handlePayPoolMbr = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()

    const toastId = `${TOAST_ID}-pay-mbr`

    try {
      if (!activeAddress) {
        throw new Error('No active address')
      }

      if (!validator) {
        throw new Error('No validator found')
      }

      if (!poolKey) {
        throw new Error('No pool found')
      }

      if (!poolInitMbr) {
        throw new Error('No MBR data found')
      }

      if (availableBalance < poolInitMbr) {
        throw new Error(`Insufficient balance: ${formatAlgoAmount(poolInitMbr)} ALGO required`)
      }

      toast.loading(`Sign transaction to pay MBR for pool ${poolKey.poolId}...`, {
        id: toastId,
      })

      const optInRewardToken =
        validator.config.rewardTokenId !== 0 && validator.state.numPools === 0

      setIsSigning(true)

      await initStakingPoolStorage(
        poolKey.poolAppId,
        poolInitMbr,
        optInRewardToken,
        transactionSigner,
        activeAddress,
      )

      toast.success(`Pool ${poolKey.poolId} MBR paid successfully!`, {
        id: toastId,
        duration: 5000,
      })

      queryClient.invalidateQueries({ queryKey: ['pools-info', validator.id] })

      // Refetch validator data
      const newData = await fetchValidator(validator!.id)
      setValidatorQueriesData(queryClient, newData)

      setProgress(100)
      setCurrentStep(3)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (error instanceof InsufficientBalanceError) {
        toast.error('Insufficient balance', {
          id: toastId,
          description: error.toastMessage,
          duration: 5000,
        })
        console.error(error)
      } else {
        toast.error('Pool storage requirement payment failed', { id: toastId })
        console.error(error)
      }
      setIsInitMbrError(error?.message)
    } finally {
      setIsSigning(false)
    }
  }

  const handleLinkPoolToNfd = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()

    const toastId = `${TOAST_ID}-link-nfd`

    try {
      if (!activeAddress) {
        throw new Error('No active address')
      }

      if (!poolKey) {
        throw new Error('No pool found')
      }

      if (!nfdToLink?.appID) {
        throw new Error('NFD app ID not found')
      }

      toast.loading(`Sign transaction to link ${$nfdToLink} to Pool ${poolKey.poolId}...`, {
        id: toastId,
      })

      setIsSigning(true)

      await linkPoolToNfd(
        poolKey.poolAppId,
        $nfdToLink,
        nfdToLink.appID,
        transactionSigner,
        activeAddress,
      )

      const poolAppAddress = algosdk.getApplicationAddress(poolKey.poolAppId)
      queryClient.setQueryData(['nfd-lookup', poolAppAddress, { view: 'thumbnail' }], nfdToLink)

      toast.success(`Pool ${poolKey.poolId} successfully linked to ${$nfdToLink}!`, {
        id: toastId,
        duration: 5000,
      })

      handleOpenChange(false)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (error instanceof InsufficientBalanceError) {
        toast.error('Insufficient balance', {
          id: toastId,
          description: error.toastMessage,
          duration: 5000,
        })
        console.error(error)
      } else {
        toast.error('Link pool to NFD failed', { id: toastId })
        console.error(error)
      }
    } finally {
      setIsSigning(false)
    }
  }

  const handleComplete = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    handleOpenChange(false)
  }

  return (
    <Dialog open={!!validator} onOpenChange={handleOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event: Event) => event.preventDefault()}
        onInteractOutside={(event: Event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Add a Pool</DialogTitle>
          <DialogDescription>
            Create and fund a new staking pool for Validator {validator?.id}
          </DialogDescription>
        </DialogHeader>
        <div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleCreatePool)}>
              <div className="[&>div>label]:step steps ml-4 pl-8 [counter-reset:step]">
                <Collapsible
                  open={currentStep == 1}
                  className={cn('relative pb-6 space-y-2', { completed: currentStep > 1 })}
                >
                  <span className="absolute -left-8 -translate-x-[1px] h-full w-px bg-muted" />
                  <FormLabel>Select Node</FormLabel>
                  <CollapsibleContent className="space-y-2">
                    <FormField
                      control={form.control}
                      name="nodeNum"
                      render={({ field }) => (
                        <FormItem
                          className={cn(
                            currentStep == 2 || !poolAssignment || !validator ? 'hidden' : '',
                          )}
                        >
                          <NodeSelect
                            nodesInfo={nodesInfo}
                            value={field.value}
                            onValueChange={field.onChange}
                          />
                          <FormDescription>
                            Select a node with an available slot (max:{' '}
                            {validator?.config.poolsPerNode})
                          </FormDescription>
                          <FormMessage>{errors.nodeNum?.message}</FormMessage>
                        </FormItem>
                      )}
                    />
                  </CollapsibleContent>
                </Collapsible>

                <Collapsible
                  open={currentStep == 2}
                  className={cn('relative pb-6 space-y-2', { completed: currentStep > 2 })}
                >
                  <span className="absolute -left-8 -translate-x-[1px] h-full w-px bg-muted" />
                  <FormLabel className={cn({ 'text-muted-foreground/50': currentStep < 2 })}>
                    Pay Minimum Required Balance
                  </FormLabel>
                  <CollapsibleContent className="space-y-2">
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">
                        To initialize the staking pool, a{' '}
                        <AlgoDisplayAmount
                          amount={poolInitMbr}
                          microalgos
                          className="text-foreground font-mono"
                        />{' '}
                        MBR payment is required.
                      </p>
                      <FormMessage className={cn({ hidden: !isInitMbrError })}>
                        {isInitMbrError}
                      </FormMessage>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <Collapsible open={currentStep == 3} className="space-y-2">
                  <FormLabel className={cn({ 'text-muted-foreground/50': currentStep < 3 })}>
                    Link Pool to NFD
                  </FormLabel>
                  <CollapsibleContent className="space-y-2">
                    <NfdLookup
                      form={form}
                      name="nfdToLink"
                      nfd={nfdToLink}
                      setNfd={setNfdToLink}
                      isFetchingNfd={isFetchingNfdToLink}
                      setIsFetchingNfd={setIsFetchingNfdToLink}
                      watchValue={$nfdToLink}
                      errorMessage={errors.nfdToLink?.message}
                      activeAddress={activeAddress}
                      validateOwner
                      warnVerified
                    />
                  </CollapsibleContent>
                </Collapsible>
              </div>
              <DialogFooter className="my-6 sm:justify-start">
                {currentStep == 1 && (
                  <Button type="submit" disabled={isSigning}>
                    Create Pool
                  </Button>
                )}
                {currentStep == 2 && (
                  <Button onClick={handlePayPoolMbr} disabled={isSigning}>
                    Send Payment
                  </Button>
                )}
                {currentStep == 3 && (
                  <>
                    <Button onClick={handleLinkPoolToNfd} disabled={isLocalnet || isSigning}>
                      Link to NFD
                    </Button>
                    <Button variant="secondary" onClick={handleComplete} disabled={isSigning}>
                      Skip for now
                    </Button>
                  </>
                )}
              </DialogFooter>

              <div className={cn('my-4')}>
                <ProgressBar value={progress} color="rose" className="mt-3" showAnimation />
              </div>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
