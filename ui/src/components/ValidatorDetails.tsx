import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useWallet } from '@txnlab/use-wallet-react'
import { Coins, PackagePlus, Pencil, Percent, Users, Waves } from 'lucide-react'
import * as React from 'react'
import { constraintsQueryOptions, poolAssignmentQueryOptions } from '@/api/queries'
import { Staked, Stakers } from '@/components/_Overview'
import { AddPoolModal } from '@/components/AddPoolModal'
import { AlgoDisplayAmount } from '@/components/AlgoDisplayAmount'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Validator } from '@/interfaces/validator'
import { calculateMaxStakers, validatorHasAvailableSlots } from '@/utils/contracts'
import { formatDuration } from '@/utils/dayjs'
import { ellipseAddress } from '@/utils/ellipseAddress'

interface ValidatorDetailsProps {
  validator: Validator
}

export function ValidatorDetails({ validator }: ValidatorDetailsProps) {
  const [addPoolValidator, setAddPoolValidator] = React.useState<Validator | null>(null)

  const { activeAddress } = useWallet()

  const isManager = validator.config.manager === activeAddress
  const isOwner = validator.config.owner === activeAddress
  const canEdit = isManager || isOwner

  const { data: poolAssignment } = useQuery(poolAssignmentQueryOptions(validator.id, canEdit))

  const constraintsQuery = useSuspenseQuery(constraintsQueryOptions)

  const hasSlots = React.useMemo(() => {
    return poolAssignment
      ? validatorHasAvailableSlots(poolAssignment, validator.config.poolsPerNode)
      : false
  }, [poolAssignment, validator.config.poolsPerNode])

  const canAddPool = canEdit && hasSlots

  const constraints = constraintsQuery.data

  const totalStakers = validator.state.totalStakers
  const maxStakers = calculateMaxStakers(validator, constraints)

  const { poolsPerNode } = validator.config
  const maxNodes = constraints.maxNodes

  return (
    <>
      <div className="py-10 space-y-4">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Staked</CardTitle>
              <Coins className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold lg:text-xl xl:text-2xl">
                <AlgoDisplayAmount
                  amount={validator.state.totalAlgoStaked}
                  microalgos
                  maxLength={13}
                  compactPrecision={2}
                  mutedRemainder
                />
              </div>
              {/* <p className="text-xs text-muted-foreground">+20.1% from last month</p> */}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Stakers</CardTitle>
              <Users className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold lg:text-xl xl:text-2xl">
                {totalStakers} / {maxStakers}
              </div>
              {/* <p className="text-xs text-muted-foreground">+180.1% from last month</p> */}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pools</CardTitle>
              <Waves className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-x-2 text-2xl font-bold lg:text-xl xl:text-2xl">
                {validator.state.numPools} / {poolsPerNode * maxNodes}
                {canAddPool && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-my-2"
                    onClick={() => setAddPoolValidator(validator)}
                  >
                    <PackagePlus className="h-5 w-5" />
                  </Button>
                )}
              </div>
              {/* <p className="text-xs text-muted-foreground">+201 since last hour</p> */}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Commission</CardTitle>
              <Percent className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold lg:text-xl xl:text-2xl">
                {`${validator.config.percentToValidator / 10000}%`}
              </div>
              {/* <p className="text-xs text-muted-foreground">+19% from last month</p> */}
            </CardContent>
          </Card>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Stake by Pool</CardTitle>
            </CardHeader>
            <CardContent className="pl-1">
              <Staked validator={validator} />
            </CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Validator Details</CardTitle>
                {/* <CardDescription>You made 265 sales this month.</CardDescription> */}
              </CardHeader>
              <CardContent className="w-full">
                <div className="border-t border-foreground-muted">
                  <dl className="divide-y divide-foreground-muted">
                    <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                      <dt className="text-sm font-medium leading-6 text-muted-foreground">Owner</dt>
                      <dd className="flex items-center gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                        {ellipseAddress(validator.config.owner)}
                      </dd>
                    </div>
                    <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                      <dt className="text-sm font-medium leading-6 text-muted-foreground">
                        Manager
                      </dt>
                      <dd className="flex items-center gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                        {ellipseAddress(validator.config.manager)}
                        {canEdit && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="-my-2">
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Edit manager</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </dd>
                    </div>
                    <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                      <dt className="text-sm font-medium leading-6 text-muted-foreground">
                        Commission Account
                      </dt>
                      <dd className="flex items-center gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                        {ellipseAddress(validator.config.validatorCommissionAddress)}
                        {canEdit && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="-my-2">
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Edit commission account</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </dd>
                    </div>
                    <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                      <dt className="text-sm font-medium leading-6 text-muted-foreground">
                        Payout Frequency
                      </dt>
                      <dd className="flex items-center gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                        <span className="capitalize">
                          {formatDuration(validator.config.payoutEveryXMins)}
                        </span>
                      </dd>
                    </div>
                    <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                      <dt className="text-sm font-medium leading-6 text-muted-foreground">
                        Minimum Entry Stake
                      </dt>
                      <dd className="flex items-center gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                        <AlgoDisplayAmount amount={validator.config.minEntryStake} microalgos />
                      </dd>
                    </div>
                    <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                      <dt className="text-sm font-medium leading-6 text-muted-foreground">
                        Maximum Stake Per Pool
                      </dt>
                      <dd className="flex items-center gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                        <AlgoDisplayAmount amount={validator.config.maxAlgoPerPool} microalgos />
                      </dd>
                    </div>
                  </dl>
                </div>
              </CardContent>
            </Card>
          </div>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Stakers in Pool</CardTitle>
            </CardHeader>
            <CardContent className="pl-2">
              <Stakers validator={validator} />
            </CardContent>
          </Card>
        </div>
      </div>

      {poolAssignment && (
        <AddPoolModal
          validator={addPoolValidator}
          setValidator={setAddPoolValidator}
          poolAssignment={poolAssignment}
        />
      )}
    </>
  )
}
