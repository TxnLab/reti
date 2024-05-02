import { Link } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet-react'
import { MessageCircleWarning } from 'lucide-react'
import { AlgoDisplayAmount } from '@/components/AlgoDisplayAmount'
import { NfdThumbnail } from '@/components/NfdThumbnail'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { EditCommissionAccount } from '@/components/ValidatorDetails/EditCommissionAccount'
import { EditEntryGating } from '@/components/ValidatorDetails/EditEntryGating'
import { EditManagerAccount } from '@/components/ValidatorDetails/EditManagerAccount'
import { EditNfdForInfo } from '@/components/ValidatorDetails/EditNfdForInfo'
import { EditRewardPerPayout } from '@/components/ValidatorDetails/EditRewardPerPayout'
import { EditSunsettingInfo } from '@/components/ValidatorDetails/EditSunsettingInfo'
import { GatingType } from '@/constants/gating'
import { Validator } from '@/interfaces/validator'
import { dayjs } from '@/utils/dayjs'
import { ellipseAddressJsx } from '@/utils/ellipseAddress'
import { ExplorerLink } from '@/utils/explorer'
import { formatAssetAmount, formatNumber } from '@/utils/format'
import { getNfdAppFromViteEnvironment } from '@/utils/network/getNfdConfig'

const nfdAppUrl = getNfdAppFromViteEnvironment()

interface DetailsProps {
  validator: Validator
}

export function Details({ validator }: DetailsProps) {
  const { activeAddress } = useWallet()

  const isOwner = activeAddress === validator.config.owner

  const renderEntryGating = () => {
    const { entryGatingType, entryGatingAddress, entryGatingAssets } = validator.config

    switch (entryGatingType) {
      case GatingType.None:
        return 'None'
      case GatingType.CreatorAccount:
        return (
          <>
            <strong className="font-medium text-muted-foreground">Asset creator</strong>{' '}
            <a
              href={ExplorerLink.account(entryGatingAddress)}
              target="_blank"
              rel="noreferrer"
              className="mt-1 font-mono whitespace-nowrap hover:underline"
            >
              {ellipseAddressJsx(entryGatingAddress)}
            </a>
          </>
        )
      case GatingType.AssetId:
        return (
          <>
            <strong className="font-medium text-muted-foreground">Asset ID</strong>
            <ul className="mt-1 list-none list-inside">
              {entryGatingAssets
                .filter((assetId) => assetId !== 0)
                .map((assetId) => (
                  <li key={assetId}>
                    <a
                      href={ExplorerLink.asset(assetId)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono hover:underline"
                    >
                      {assetId}
                    </a>
                  </li>
                ))}
            </ul>
          </>
        )
      case GatingType.CreatorNfd:
        return (
          <>
            <strong className="font-medium text-muted-foreground">Asset creator</strong>{' '}
            <div className="truncate">
              <NfdThumbnail nameOrId={entryGatingAssets[0]} truncate tooltip link />
            </div>
          </>
        )
      case GatingType.SegmentNfd:
        return (
          <>
            <strong className="font-medium text-muted-foreground">Segment of</strong>{' '}
            <div className="truncate">
              <NfdThumbnail nameOrId={entryGatingAssets[0]} truncate tooltip link />
            </div>
          </>
        )
      default:
        return 'None'
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Validator Details</CardTitle>
        </CardHeader>
        <CardContent className="w-full">
          <div className="border-t border-foreground-muted">
            <dl className="divide-y divide-foreground-muted">
              <div className="py-4 grid grid-cols-[2fr_3fr] gap-4 xl:grid-cols-2">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">
                  Validator ID
                </dt>
                <dd className="flex items-center gap-x-2 text-sm leading-6">{validator.id}</dd>
              </div>
              <div className="py-4 grid grid-cols-[2fr_3fr] gap-4 xl:grid-cols-2">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">Owner</dt>
                <dd className="flex items-center justify-between gap-x-2 text-sm font-mono leading-6">
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
              <div className="py-4 grid grid-cols-[2fr_3fr] gap-4 xl:grid-cols-2">
                <dt className="flex items-center text-sm font-medium leading-6 text-muted-foreground">
                  Manager
                </dt>
                <dd className="flex items-center justify-between gap-x-2 text-sm font-mono leading-6">
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
              <div className="py-4 grid grid-cols-[2fr_3fr] gap-4 xl:grid-cols-2">
                <dt className="flex items-center text-sm font-medium leading-6 text-muted-foreground">
                  Commission Account
                </dt>
                <dd className="flex items-center justify-between gap-x-2 text-sm font-mono leading-6">
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

              {(isOwner || validator.nfd) && (
                <div className="py-4 grid grid-cols-[2fr_3fr] gap-4 xl:grid-cols-2">
                  <dt className="flex items-center text-sm font-medium leading-6 text-muted-foreground">
                    Associated NFD
                  </dt>
                  <dd className="flex items-center justify-between gap-x-2 text-sm font-medium leading-6">
                    {validator.nfd ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <a
                              href={`${nfdAppUrl}/name/${validator.nfd.name}`}
                              target="_blank"
                              rel="noreferrer"
                              className="truncate hover:underline"
                            >
                              {validator.nfd.name}
                            </a>
                          </TooltipTrigger>
                          <TooltipContent className="bg-stone-900 text-white font-semibold tracking-tight dark:bg-white dark:text-stone-900">
                            {validator.nfd.name}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
                    {isOwner && <EditNfdForInfo validator={validator} />}
                  </dd>
                </div>
              )}

              <div className="py-4 grid grid-cols-[2fr_3fr] gap-4 xl:grid-cols-2">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">
                  Minimum Entry Stake
                </dt>
                <dd className="flex items-center justify-between gap-x-2 text-sm leading-6">
                  <AlgoDisplayAmount
                    amount={validator.config.minEntryStake}
                    microalgos
                    className="font-mono"
                  />
                </dd>
              </div>
              <div className="py-4 grid grid-cols-[2fr_3fr] gap-4 xl:grid-cols-2">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">
                  Epoch Length
                </dt>
                <dd className="flex items-center justify-between gap-x-2 text-sm leading-6">
                  <span className="capitalize">
                    {formatNumber(validator.config.epochRoundLength)} blocks
                  </span>
                </dd>
              </div>
              <div className="py-4 grid grid-cols-[2fr_3fr] gap-4 xl:grid-cols-2">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">
                  Commission Rate
                </dt>
                <dd className="flex items-center justify-between gap-x-2 text-sm leading-6">
                  {`${validator.config.percentToValidator / 10000}%`}
                </dd>
              </div>
              <div className="py-4 grid grid-cols-[2fr_3fr] gap-4 xl:grid-cols-2">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">
                  Pools Per Node
                </dt>
                <dd className="flex items-center justify-between gap-x-2 text-sm leading-6">
                  {validator.config.poolsPerNode}
                </dd>
              </div>

              {validator.config.rewardTokenId > 0 && (
                <>
                  <div className="py-4 grid grid-cols-[2fr_3fr] gap-4 xl:grid-cols-2">
                    <dt className="text-sm font-medium leading-6 text-muted-foreground">
                      Reward Token
                    </dt>
                    <dd className="flex items-center justify-between gap-x-2 text-sm leading-6">
                      {validator.config.rewardTokenId === 0 ? (
                        <span className="text-muted-foreground">--</span>
                      ) : (
                        validator.config.rewardTokenId
                      )}
                    </dd>
                  </div>
                  <div className="py-4 grid grid-cols-[2fr_3fr] gap-4 xl:grid-cols-2">
                    <dt className="text-sm font-medium leading-6 text-muted-foreground">
                      Reward Per Payout
                    </dt>
                    <dd className="flex items-center justify-between gap-x-2 text-sm leading-6">
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
                </>
              )}

              {(isOwner || validator.config.entryGatingType > 0) && (
                <>
                  <div className="py-4 grid grid-cols-[2fr_3fr] gap-4 xl:grid-cols-2">
                    <dt className="text-sm font-medium leading-6 text-muted-foreground">
                      Entry Gating
                    </dt>
                    <dd className="flex items-center justify-between gap-x-2 text-sm leading-6">
                      {validator.config.entryGatingType === 0 ? (
                        <span className="text-muted-foreground">--</span>
                      ) : (
                        <div className="text-sm">{renderEntryGating()}</div>
                      )}
                      {isOwner && <EditEntryGating validator={validator} />}
                    </dd>
                  </div>

                  {![GatingType.None, GatingType.SegmentNfd].includes(
                    validator.config.entryGatingType,
                  ) && (
                    <div className="py-4 grid grid-cols-[2fr_3fr] gap-4 xl:grid-cols-2">
                      <dt className="text-sm font-medium leading-6 text-muted-foreground">
                        Gating Asset Minimum Balance
                      </dt>
                      <dd className="flex items-center justify-between gap-x-2 text-sm font-mono leading-6">
                        {formatAssetAmount(validator.config.gatingAssetMinBalance.toString())}
                      </dd>
                    </div>
                  )}
                </>
              )}

              {isOwner || validator.config.sunsettingOn ? (
                <div className="py-4 grid grid-cols-[2fr_3fr] gap-4 xl:grid-cols-2">
                  <dt className="text-sm font-medium leading-6 text-muted-foreground">
                    Sunset Date
                  </dt>
                  <dd className="flex items-center justify-between gap-x-2 text-sm leading-6">
                    {validator.config.sunsettingOn === 0 ? (
                      <span className="text-muted-foreground">--</span>
                    ) : (
                      dayjs.unix(Number(validator.config.sunsettingOn)).format('ll')
                    )}
                    {isOwner && <EditSunsettingInfo validator={validator} />}
                  </dd>
                  {validator.config.sunsettingTo > 0 && (
                    <Alert className="col-span-2 mt-1 bg-background/50">
                      <MessageCircleWarning className="h-5 w-5 -mt-1" />
                      <AlertTitle>Migration Notice</AlertTitle>
                      <AlertDescription>
                        Stakers should migrate to{' '}
                        <Link
                          to="/validators/$validatorId"
                          params={{ validatorId: String(validator.config.sunsettingTo) }}
                          className="hover:underline underline-offset-4"
                        >
                          Validator {validator.config.sunsettingTo}
                        </Link>
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              ) : null}
            </dl>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
