import { AlgoDisplayAmount } from '@/components/AlgoDisplayAmount'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Validator } from '@/interfaces/validator'
import { dayjs, formatDuration } from '@/utils/dayjs'
import { ellipseAddressJsx } from '@/utils/ellipseAddress'
import { ExplorerLink } from '@/utils/explorer'
import { EditManagerAccount } from '@/components/ValidatorDetails/EditManagerAccount'
import { EditCommissionAccount } from './EditCommissionAccount'
import { useWallet } from '@txnlab/use-wallet-react'
import { EditSunsettingInfo } from './EditSunsettingInfo'
import { getNfdAppFromViteEnvironment } from '@/utils/network/getNfdConfig'
import { EditNfdForInfo } from './EditNfdForInfo'
import { EditRewardPerPayout } from './EditRewardPerPayout'
import { EditEntryGating } from './EditEntryGating'

const nfdAppUrl = getNfdAppFromViteEnvironment()

interface DetailsProps {
  validator: Validator
}

export function Details({ validator }: DetailsProps) {
  const { activeAddress } = useWallet()

  const isOwner = activeAddress === validator.config.owner

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
                <dt className="text-sm font-medium leading-6 text-muted-foreground">ID</dt>
                <dd className="flex items-center gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                  {validator.id}
                </dd>
              </div>
              <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">Owner</dt>
                <dd className="flex items-center justify-between gap-x-2 mt-1 text-sm font-mono leading-6 sm:mt-0">
                  <a
                    href={ExplorerLink.account(validator.config.owner)}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    {ellipseAddressJsx(validator.config.owner)}
                  </a>
                </dd>
              </div>
              <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                <dt className="flex items-center text-sm font-medium leading-6 text-muted-foreground">
                  Manager
                </dt>
                <dd className="flex items-center justify-between gap-x-2 mt-1 text-sm font-mono leading-6 sm:mt-0">
                  <a
                    href={ExplorerLink.account(validator.config.manager)}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    {ellipseAddressJsx(validator.config.manager)}
                  </a>
                  {isOwner && <EditManagerAccount validator={validator} />}
                </dd>
              </div>
              <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                <dt className="flex items-center text-sm font-medium leading-6 text-muted-foreground">
                  Commission Account
                </dt>
                <dd className="flex items-center justify-between gap-x-2 mt-1 text-sm font-mono leading-6 sm:mt-0">
                  <a
                    href={ExplorerLink.account(validator.config.validatorCommissionAddress)}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    {ellipseAddressJsx(validator.config.validatorCommissionAddress)}
                  </a>
                  {isOwner && <EditCommissionAccount validator={validator} />}
                </dd>
              </div>
              <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                <dt className="flex items-center text-sm font-medium leading-6 text-muted-foreground">
                  Associated NFD
                </dt>
                <dd className="flex items-center justify-between gap-x-2 mt-1 text-sm font-mono leading-6 sm:mt-0">
                  {validator.nfd ? (
                    <a
                      href={`${nfdAppUrl}/name/${validator.nfd.name}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      {validator.nfd.name}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  )}
                  {isOwner && <EditNfdForInfo validator={validator} />}
                </dd>
              </div>
              <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">
                  Minimum Entry Stake
                </dt>
                <dd className="flex items-center justify-between gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                  <AlgoDisplayAmount
                    amount={validator.config.minEntryStake}
                    microalgos
                    className="font-mono"
                  />
                </dd>
              </div>
              <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">
                  Epoch Length
                </dt>
                <dd className="flex items-center justify-between gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                  <span className="capitalize">
                    {formatDuration(validator.config.payoutEveryXMins)}
                  </span>
                </dd>
              </div>
              <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">
                  Commission Rate
                </dt>
                <dd className="flex items-center justify-between gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                  {`${validator.config.percentToValidator / 10000}%`}
                </dd>
              </div>
              <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">
                  Pools Per Node
                </dt>
                <dd className="flex items-center justify-between gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                  {validator.config.poolsPerNode}
                </dd>
              </div>
              <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">
                  Reward Token
                </dt>
                <dd className="flex items-center justify-between gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
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
                <dd className="flex items-center justify-between gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                  {Number(validator.config.rewardPerPayout) === 0 ? (
                    <span className="text-muted-foreground">--</span>
                  ) : (
                    Number(validator.config.rewardPerPayout)
                  )}
                  {isOwner && validator.config.rewardTokenId > 0 && (
                    <EditRewardPerPayout validator={validator} />
                  )}
                </dd>
              </div>
              <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">
                  Entry Gating
                </dt>
                <dd className="flex items-center justify-between gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                  {validator.config.entryGatingType === 0 ? (
                    <span className="text-muted-foreground">--</span>
                  ) : (
                    validator.config.entryGatingType
                  )}
                  {isOwner && <EditEntryGating validator={validator} />}
                </dd>
              </div>
              {isOwner || validator.config.sunsettingOn ? (
                <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                  <dt className="text-sm font-medium leading-6 text-muted-foreground">
                    Sunsetting On
                  </dt>
                  <dd className="flex items-center justify-between gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                    {validator.config.sunsettingOn === 0 ? (
                      <span className="text-muted-foreground">--</span>
                    ) : (
                      dayjs.unix(Number(validator.config.sunsettingOn)).format('ll')
                    )}
                    {isOwner && <EditSunsettingInfo validator={validator} />}
                  </dd>
                </div>
              ) : null}
              {isOwner || validator.config.sunsettingTo ? (
                <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                  <dt className="text-sm font-medium leading-6 text-muted-foreground">
                    Sunsetting To (ID)
                  </dt>
                  <dd className="flex items-center justify-between gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                    {validator.config.sunsettingTo === 0 ? (
                      <span className="text-muted-foreground">--</span>
                    ) : (
                      validator.config.sunsettingTo
                    )}
                    {isOwner && <EditSunsettingInfo validator={validator} />}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
