import { AlgoDisplayAmount } from '@/components/AlgoDisplayAmount'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Validator } from '@/interfaces/validator'
import { formatDuration } from '@/utils/dayjs'
import { ellipseAddress } from '@/utils/ellipseAddress'

interface DetailsProps {
  validator: Validator
}

export function Details({ validator }: DetailsProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Validator Details</CardTitle>
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
                <dt className="text-sm font-medium leading-6 text-muted-foreground">Manager</dt>
                <dd className="flex items-center gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                  {ellipseAddress(validator.config.manager)}
                </dd>
              </div>
              <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">
                  Commission Account
                </dt>
                <dd className="flex items-center gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                  {ellipseAddress(validator.config.validatorCommissionAddress)}
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
                  Epoch Length
                </dt>
                <dd className="flex items-center gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                  <span className="capitalize">
                    {formatDuration(validator.config.payoutEveryXMins)}
                  </span>
                </dd>
              </div>
              <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">
                  Commission Rate
                </dt>
                <dd className="flex items-center gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                  {`${validator.config.percentToValidator / 10000}%`}
                </dd>
              </div>
              <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">
                  Pools Per Node
                </dt>
                <dd className="flex items-center gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                  {validator.config.poolsPerNode}
                </dd>
              </div>
              <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">
                  Reward Token
                </dt>
                <dd className="flex items-center gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                  {validator.config.rewardTokenId === 0 ? (
                    <span className="text-muted-foreground">--</span>
                  ) : (
                    validator.config.rewardTokenId
                  )}
                </dd>
              </div>
              <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">
                  Reward Per Payout
                </dt>
                <dd className="flex items-center gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                  {Number(validator.config.rewardPerPayout) === 0 ? (
                    <span className="text-muted-foreground">--</span>
                  ) : (
                    Number(validator.config.rewardPerPayout)
                  )}
                </dd>
              </div>
              <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">
                  Entry Gating
                </dt>
                <dd className="flex items-center gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                  {validator.config.entryGatingType === 0 ? (
                    <span className="text-muted-foreground">--</span>
                  ) : (
                    validator.config.entryGatingType
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
