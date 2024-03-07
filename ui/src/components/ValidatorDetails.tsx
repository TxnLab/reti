import { Coins, Percent, Users, Waves } from 'lucide-react'
import { Overview } from '@/components/_Overview'
import { AlgoAmount } from '@/components/AlgoAmount'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Validator } from '@/interfaces/validator'
import { formatDuration } from '@/utils/dayjs'
import { ellipseAddress } from '@/utils/ellipseAddress'

interface ValidatorDetailsProps {
  validator: Validator
}

export function ValidatorDetails({ validator }: ValidatorDetailsProps) {
  return (
    <div className="py-10 space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Staked</CardTitle>
            <Coins className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold lg:text-xl xl:text-2xl">
              <AlgoAmount
                amount={validator.totalStaked}
                microalgos
                maxLength={13}
                compactPrecision={2}
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
            <div className="text-2xl font-bold lg:text-xl xl:text-2xl">{validator.numStakers}</div>
            {/* <p className="text-xs text-muted-foreground">+180.1% from last month</p> */}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pools</CardTitle>
            <Waves className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold lg:text-xl xl:text-2xl">
              {Number(validator.numPools)}
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
            <div className="text-2xl font-bold lg:text-xl xl:text-2xl">{`${Number(validator.commission) / 10000}%`}</div>
            {/* <p className="text-xs text-muted-foreground">+19% from last month</p> */}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-7">
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Analytics</CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
            <Overview />
          </CardContent>
        </Card>
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
                  <dd className="mt-1 text-sm leading-6 sm:mt-0">
                    {ellipseAddress(validator.owner)}
                  </dd>
                </div>
                <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                  <dt className="text-sm font-medium leading-6 text-muted-foreground">Manager</dt>
                  <dd className="mt-1 text-sm leading-6 sm:mt-0">
                    {ellipseAddress(validator.manager)}
                  </dd>
                </div>
                <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                  <dt className="text-sm font-medium leading-6 text-muted-foreground">
                    Commission Account
                  </dt>
                  <dd className="mt-1 text-sm leading-6 sm:mt-0">
                    {ellipseAddress(validator.commissionAccount)}
                  </dd>
                </div>
                <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                  <dt className="text-sm font-medium leading-6 text-muted-foreground">
                    Payout Frequency
                  </dt>
                  <dd className="mt-1 text-sm leading-6 sm:mt-0">
                    {formatDuration(Number(validator.payoutFrequency))}
                  </dd>
                </div>
                <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                  <dt className="text-sm font-medium leading-6 text-muted-foreground">
                    Minimum Entry Stake
                  </dt>
                  <dd className="mt-1 text-sm leading-6 sm:mt-0">
                    <AlgoAmount amount={validator.minStake} microalgos />
                  </dd>
                </div>
                <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                  <dt className="text-sm font-medium leading-6 text-muted-foreground">
                    Maximum Total Stake
                  </dt>
                  <dd className="mt-1 text-sm leading-6 sm:mt-0">
                    <AlgoAmount amount={validator.maxStake} microalgos />
                  </dd>
                </div>
              </dl>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
