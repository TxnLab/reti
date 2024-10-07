import { useQuery } from '@tanstack/react-query'
import { useWallet } from '@txnlab/use-wallet-react'
import { CirclePlus, Coins, Percent, Users } from 'lucide-react'
import * as React from 'react'
import { poolAssignmentQueryOptions } from '@/api/queries'
import { AddPoolModal } from '@/components/AddPoolModal'
import { AlgoDisplayAmount } from '@/components/AlgoDisplayAmount'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Validator } from '@/interfaces/validator'
import { calculateMaxStakers, validatorHasAvailableSlots } from '@/utils/contracts'
import { Constraints } from '@/contracts/ValidatorRegistryClient'

interface HighlightsProps {
  validator: Validator
  constraints: Constraints
}

export function Highlights({ validator, constraints }: HighlightsProps) {
  const [addPoolValidator, setAddPoolValidator] = React.useState<Validator | null>(null)

  const { activeAddress } = useWallet()

  const isManager = validator.config.manager === activeAddress
  const isOwner = validator.config.owner === activeAddress
  const canEdit = isManager || isOwner

  const { data: poolAssignment } = useQuery(poolAssignmentQueryOptions(validator.id, canEdit))

  const hasSlots = React.useMemo(() => {
    return poolAssignment
      ? validatorHasAvailableSlots(poolAssignment, Number(validator.config.poolsPerNode))
      : false
  }, [poolAssignment, validator.config.poolsPerNode])

  const canAddPool = canEdit && hasSlots

  const totalStakers = validator.state.totalStakers
  const maxStakers = calculateMaxStakers(validator, constraints)
  const { poolsPerNode } = validator.config
  const maxNodes = constraints.maxNodes

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle as="h2" className="text-sm font-medium">
              Total Staked
            </CardTitle>
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
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle as="h2" className="text-sm font-medium">
              Stakers
            </CardTitle>
            <Users className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold lg:text-xl xl:text-2xl">
              {totalStakers.toString()}{' '}
              <span className="text-muted-foreground">/ {maxStakers.toString()}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle as="h2" className="text-sm font-medium">
              Pools
            </CardTitle>
            <svg
              viewBox="0 0 576 512"
              className="h-5 w-5 text-muted-foreground"
              fill="currentColor"
            >
              <path d="M128 127.7C128 74.9 170.9 32 223.7 32c48.3 0 89 36 95 83.9l1 8.2c2.2 17.5-10.2 33.5-27.8 35.7s-33.5-10.2-35.7-27.8l-1-8.2c-2-15.9-15.5-27.8-31.5-27.8c-17.5 0-31.7 14.2-31.7 31.7V224H384V127.7C384 74.9 426.9 32 479.7 32c48.3 0 89 36 95 83.9l1 8.2c2.2 17.5-10.2 33.5-27.8 35.7s-33.5-10.2-35.7-27.8l-1-8.2c-2-15.9-15.5-27.8-31.5-27.8c-17.5 0-31.7 14.2-31.7 31.7V361c-1.6 1-3.3 2-4.8 3.1c-18 12.4-40.1 20.3-59.2 20.3h0V288H192v96.5c-19 0-41.2-7.9-59.1-20.3c-1.6-1.1-3.2-2.2-4.9-3.1V127.7zM306.5 389.9C329 405.4 356.5 416 384 416c26.9 0 55.4-10.8 77.4-26.1l0 0c11.9-8.5 28.1-7.8 39.2 1.7c14.4 11.9 32.5 21 50.6 25.2c17.2 4 27.9 21.2 23.9 38.4s-21.2 27.9-38.4 23.9c-24.5-5.7-44.9-16.5-58.2-25C449.5 469.7 417 480 384 480c-31.9 0-60.6-9.9-80.4-18.9c-5.8-2.7-11.1-5.3-15.6-7.7c-4.5 2.4-9.7 5.1-15.6 7.7c-19.8 9-48.5 18.9-80.4 18.9c-33 0-65.5-10.3-94.5-25.8c-13.4 8.4-33.7 19.3-58.2 25c-17.2 4-34.4-6.7-38.4-23.9s6.7-34.4 23.9-38.4c18.1-4.2 36.2-13.3 50.6-25.2c11.1-9.4 27.3-10.1 39.2-1.7l0 0C136.7 405.2 165.1 416 192 416c27.5 0 55-10.6 77.5-26.1c11.1-7.9 25.9-7.9 37 0z" />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-x-2 text-2xl font-bold lg:text-xl xl:text-2xl">
              {validator.state.numPools.toString()}{' '}
              <span className="text-muted-foreground">
                / {(poolsPerNode * maxNodes).toString()}
              </span>
              {canAddPool && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="group -my-2"
                  onClick={() => setAddPoolValidator(validator)}
                >
                  <CirclePlus className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-foreground" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle as="h2" className="text-sm font-medium">
              Commission
            </CardTitle>
            <Percent className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold lg:text-xl xl:text-2xl">
              {`${Number(validator.config.percentToValidator) / 10000}%`}
            </div>
          </CardContent>
        </Card>
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
