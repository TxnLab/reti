import { useWallet } from '@txnlab/use-wallet-react'
import { AlgoDisplayAmount } from '@/components/AlgoDisplayAmount'
import { DisplayAsset } from '@/components/DisplayAsset'
import { Loading } from '@/components/Loading'
import { NfdThumbnail } from '@/components/NfdThumbnail'
import { Tooltip } from '@/components/Tooltip'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EditCommissionAccount } from '@/components/ValidatorDetails/EditCommissionAccount'
import { EditEntryGating } from '@/components/ValidatorDetails/EditEntryGating'
import { EditManagerAccount } from '@/components/ValidatorDetails/EditManagerAccount'
import { EditNfdForInfo } from '@/components/ValidatorDetails/EditNfdForInfo'
import { EditRewardPerPayout } from '@/components/ValidatorDetails/EditRewardPerPayout'
import { EditSunsettingInfo } from '@/components/ValidatorDetails/EditSunsettingInfo'
import { GatingType } from '@/constants/gating'
import { Validator } from '@/interfaces/validator'
import { useRewardBalance } from '@/hooks/useRewardBalance'
import { dayjs } from '@/utils/dayjs'
import { ellipseAddressJsx } from '@/utils/ellipseAddress'
import { ExplorerLink } from '@/utils/explorer'
import { formatAmount, formatAssetAmount } from '@/utils/format'
import { getNfdAppFromViteEnvironment } from '@/utils/network/getNfdConfig'

const nfdAppUrl = getNfdAppFromViteEnvironment()

interface DetailsProps {
  validator: Validator
}

export function Details({ validator }: DetailsProps) {
  const { activeAddress } = useWallet()
  const isOwner = activeAddress === validator.config.owner

  const rewardBalanceQuery = useRewardBalance(validator)

  const renderRewardBalance = () => {
    if (rewardBalanceQuery.isLoading) {
      return <Loading inline />
    }

    if (rewardBalanceQuery.error || rewardBalanceQuery.data === undefined) {
      return <span className="text-destructive">Error</span>
    }

    if (!validator.rewardToken) {
      return <em className="text-muted-foreground italic">{Number(rewardBalanceQuery.data)}</em>
    }

    return (
      <span className="font-mono">
        {formatAssetAmount(validator.rewardToken, rewardBalanceQuery.data, {
          unitName: true,
        })}
      </span>
    )
  }

  const renderRewardPerPayout = () => {
    if (validator.config.rewardPerPayout === 0n) {
      return <span className="text-muted-foreground">--</span>
    }

    if (!validator.rewardToken) {
      return (
        <em className="text-muted-foreground italic">{Number(validator.config.rewardPerPayout)}</em>
      )
    }

    return (
      <span className="font-mono">
        {formatAssetAmount(validator.rewardToken, validator.config.rewardPerPayout, {
          unitName: true,
        })}
      </span>
    )
  }

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
      // @todo: Fetch gating assets and display unit names
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
                    className="link"
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
                    className="link"
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
                    className="link"
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
                      <Tooltip content={validator.nfd.name}>
                        <a
                          href={`${nfdAppUrl}/name/${validator.nfd.name}`}
                          target="_blank"
                          rel="noreferrer"
                          className="link truncate"
                        >
                          {validator.nfd.name}
                        </a>
                      </Tooltip>
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
                    {formatAmount(validator.config.epochRoundLength)} blocks
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
                      <DisplayAsset asset={validator.rewardToken} show="full" link />
                    </dd>
                  </div>
                  <div className="py-4 grid grid-cols-[2fr_3fr] gap-4 xl:grid-cols-2">
                    <dt className="text-sm font-medium leading-6 text-muted-foreground">
                      Reward Per Payout
                    </dt>
                    <dd className="flex items-center justify-between gap-x-2 text-sm leading-6">
                      {renderRewardPerPayout()}
                      {isOwner && validator.config.rewardTokenId > 0 && (
                        <EditRewardPerPayout validator={validator} />
                      )}
                    </dd>
                  </div>
                  <div className="py-4 grid grid-cols-[2fr_3fr] gap-4 xl:grid-cols-2">
                    <dt className="text-sm font-medium leading-6 text-muted-foreground">
                      Reward Token Balance
                    </dt>
                    <dd className="flex items-center justify-between gap-x-2 text-sm leading-6">
                      {renderRewardBalance()}
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

                  {/* @todo: convertFromBaseUnits each asset's min balance and display unit name */}
                  {![GatingType.None, GatingType.SegmentNfd].includes(
                    validator.config.entryGatingType,
                  ) && (
                    <div className="py-4 grid grid-cols-[2fr_3fr] gap-4 xl:grid-cols-2">
                      <dt className="text-sm font-medium leading-6 text-muted-foreground">
                        Gating Asset Minimum Balance
                      </dt>
                      <dd className="flex items-center justify-between gap-x-2 text-sm font-mono leading-6">
                        {formatAmount(validator.config.gatingAssetMinBalance.toString())}
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
                </div>
              ) : null}
            </dl>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
