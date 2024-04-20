import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { useQueries, useQuery } from '@tanstack/react-query'
import { BarList, EventProps, ProgressBar } from '@tremor/react'
import { useWallet } from '@txnlab/use-wallet-react'
import { Copy } from 'lucide-react'
import * as React from 'react'
import { stakedInfoQueryOptions, validatorPoolsQueryOptions } from '@/api/queries'
import { AddStakeModal } from '@/components/AddStakeModal'
import { AlgoDisplayAmount } from '@/components/AlgoDisplayAmount'
import { Loading } from '@/components/Loading'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { UnstakeModal } from '@/components/UnstakeModal'
import { PoolsChart } from '@/components/ValidatorDetails/PoolsChart'
import { StakedInfo, StakerValidatorData } from '@/interfaces/staking'
import { Constraints, Validator } from '@/interfaces/validator'
import { isStakingDisabled, isUnstakingDisabled } from '@/utils/contracts'
import { copyToClipboard } from '@/utils/copyToClipboard'
import { ellipseAddressJsx } from '@/utils/ellipseAddress'
import { ExplorerLink } from '@/utils/explorer'
import { convertFromBaseUnits, roundToFirstNonZeroDecimal } from '@/utils/format'
import { cn } from '@/utils/ui'

interface StakingDetailsProps {
  validator: Validator
  stakesByValidator: StakerValidatorData[]
  constraints: Constraints
}

export function StakingDetails({ validator, constraints, stakesByValidator }: StakingDetailsProps) {
  const [selectedPool, setSelectedPool] = React.useState<string>('all')
  const [addStakeValidator, setAddStakeValidator] = React.useState<Validator | null>(null)
  const [unstakeValidator, setUnstakeValidator] = React.useState<Validator | null>(null)

  const { activeAddress } = useWallet()

  const stakingDisabled = isStakingDisabled(activeAddress, validator, constraints)
  const unstakingDisabled = isUnstakingDisabled(activeAddress, validator, stakesByValidator)

  const poolData =
    validator?.pools.map((pool, index) => ({
      name: `Pool ${index + 1}`,
      value: convertFromBaseUnits(Number(pool.totalAlgoStaked), 6),
    })) || []

  const poolsInfoQuery = useQuery(validatorPoolsQueryOptions(validator.id))
  const poolsInfo = poolsInfoQuery.data || []

  const allStakedInfo = useQueries({
    queries: poolsInfo.map((pool) => stakedInfoQueryOptions(pool.poolAppId)),
  })

  const isLoading = poolsInfoQuery.isLoading || allStakedInfo.some((query) => query.isLoading)
  const isError = poolsInfoQuery.isError || allStakedInfo.some((query) => query.isError)

  const chartData = React.useMemo(() => {
    if (!allStakedInfo) {
      return []
    }

    const stakedInfo = allStakedInfo
      .map((query) => query.data || [])
      .reduce((acc, stakers, i) => {
        if (selectedPool !== 'all' && Number(selectedPool) !== i) {
          return acc
        }

        // Temporary fix to handle duplicate staker bug
        const poolStakers: StakedInfo[] = []
        for (const staker of stakers) {
          const stakerIndex = poolStakers.findIndex((s) => s.account === staker.account)
          if (stakerIndex > -1) {
            staker.account += ' ' // add space to make it unique
          }
          poolStakers.push(staker)
        }

        for (const staker of poolStakers) {
          const stakerIndex = acc.findIndex((s) => s.account === staker.account)
          if (stakerIndex > -1) {
            acc[stakerIndex].balance += staker.balance
            acc[stakerIndex].totalRewarded += staker.totalRewarded
            acc[stakerIndex].rewardTokenBalance += staker.rewardTokenBalance
          } else {
            acc.push(staker)
          }
        }
        return acc
      }, [] as StakedInfo[])

    return stakedInfo.map((staker) => ({
      name: staker.account,
      value: Number(staker.balance),
      href: ExplorerLink.account(staker.account).trim(), // trim to remove trailing whitespace
    }))
  }, [allStakedInfo, selectedPool])

  const valueFormatter = (v: number) => (
    <AlgoDisplayAmount
      amount={v}
      microalgos
      maxLength={13}
      compactPrecision={2}
      trim={false}
      mutedRemainder
      className="font-mono"
    />
  )

  const getPoolIndexFromName = <T extends boolean>(
    name: number | string,
    asString?: T,
  ): T extends true ? string : number => {
    const index = Number(String(name).split('Pool ')[1]) - 1
    return (asString ? String(index) : index) as T extends true ? string : number
  }

  const getPoolNameFromIndex = (index: number | string): string => {
    return `Pool ${Number(index) + 1}`
  }

  const handlePoolClick = (eventProps: EventProps) => {
    const selected = !eventProps ? 'all' : getPoolIndexFromName(eventProps.name, true)
    setSelectedPool(selected)
  }

  const selectedPoolInfo = selectedPool === 'all' ? null : poolsInfo[Number(selectedPool)]

  // @todo: clean this way up
  const numPools = validator.state.numPools
  const hardMaxDividedBetweenPools =
    numPools > 0 ? constraints.maxAlgoPerValidator / BigInt(numPools) : BigInt(0)
  const maxMicroalgoPerPool =
    validator.config.maxAlgoPerPool == BigInt(0)
      ? hardMaxDividedBetweenPools
      : hardMaxDividedBetweenPools < validator.config.maxAlgoPerPool
        ? hardMaxDividedBetweenPools
        : validator.config.maxAlgoPerPool
  const maxAlgoPerPool = Number(maxMicroalgoPerPool / BigInt(1e6))
  const selectedPoolAlgoStake =
    selectedPool === 'all'
      ? 0
      : AlgoAmount.MicroAlgos(Number(poolsInfo[Number(selectedPool)].totalAlgoStaked)).algos
  const selectedPoolPercent =
    selectedPool === 'all'
      ? 0
      : roundToFirstNonZeroDecimal((selectedPoolAlgoStake / maxAlgoPerPool) * 100)
  const totalPercent = roundToFirstNonZeroDecimal(
    (Number(validator.state.totalAlgoStaked) / Number(constraints.maxAlgoPerValidator)) * 100,
  )

  const renderPoolInfo = () => {
    if (!selectedPoolInfo) {
      return (
        <div className="w-full">
          <div className="py-6 px-4 sm:px-0">
            <h4 className="text-xl font-semibold leading-none tracking-tight">All Pools</h4>
          </div>
          <div className="border-t border-foreground-muted">
            <dl className="divide-y divide-foreground-muted">
              <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">Total Pools</dt>
                <dd className="flex items-center gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                  {validator.state.numPools}
                </dd>
              </div>
              <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">
                  Total Stakers
                </dt>
                <dd className="flex items-center gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                  {validator.state.totalStakers}
                </dd>
              </div>
              <div className="px-4 py-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">
                  Total Staked
                </dt>
                <dd className="flex items-center gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                  <div className="w-full mt-1">
                    <p className="text-tremor-default text-tremor-content dark:text-dark-tremor-content flex items-center justify-between">
                      <span>
                        <AlgoDisplayAmount
                          amount={validator.state.totalAlgoStaked}
                          microalgos
                          maxLength={5}
                          compactPrecision={2}
                          mutedRemainder
                          className="font-mono text-foreground"
                        />{' '}
                        &bull; {totalPercent}%
                      </span>
                      <AlgoDisplayAmount
                        amount={constraints.maxAlgoPerValidator}
                        microalgos
                        maxLength={5}
                        compactPrecision={2}
                        mutedRemainder
                        className="font-mono"
                      />
                    </p>
                    <ProgressBar value={totalPercent} color="rose" className="mt-3" />
                  </div>
                </dd>
              </div>
            </dl>
          </div>
        </div>
      )
    }

    const selectedPoolName = getPoolNameFromIndex(selectedPool)

    return (
      <div className="w-full">
        <div className="py-6 px-4 sm:px-0">
          <h4 className="text-xl font-semibold leading-none tracking-tight">{selectedPoolName}</h4>
        </div>
        <div className="border-t border-foreground-muted">
          <dl className="divide-y divide-foreground-muted">
            {!!selectedPoolInfo.poolAddress && (
              <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">Address</dt>
                <dd className="flex items-center gap-x-2 mt-1 text-sm font-mono leading-6 sm:mt-0">
                  <a
                    href={ExplorerLink.account(selectedPoolInfo.poolAddress)}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    {ellipseAddressJsx(selectedPoolInfo.poolAddress)}
                  </a>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="group h-8 w-8 -my-1"
                    data-clipboard-text={selectedPoolInfo.poolAddress}
                    onClick={copyToClipboard}
                  >
                    <Copy className="h-4 w-4 opacity-60 transition-opacity group-hover:opacity-100" />
                  </Button>
                </dd>
              </div>
            )}
            <div className="px-4 py-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0">
              <dt className="text-sm font-medium leading-6 text-muted-foreground">Stakers</dt>
              <dd className="flex items-center gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                {selectedPoolInfo.totalStakers}
              </dd>
            </div>
            <div className="px-4 py-4 sm:px-0">
              <dt className="text-sm font-medium leading-6 text-muted-foreground">Staked</dt>
              <dd className="flex items-center gap-x-2 mt-1 text-sm leading-6 sm:mt-0">
                <div className="w-full mt-1">
                  <p className="text-tremor-default text-tremor-content dark:text-dark-tremor-content flex items-center justify-between">
                    <span>
                      <AlgoDisplayAmount
                        amount={selectedPoolInfo.totalAlgoStaked}
                        microalgos
                        maxLength={5}
                        compactPrecision={2}
                        mutedRemainder
                        className="font-mono text-foreground"
                      />{' '}
                      &bull; {selectedPoolPercent}%
                    </span>
                    <AlgoDisplayAmount
                      amount={maxAlgoPerPool}
                      maxLength={5}
                      compactPrecision={2}
                      mutedRemainder
                      className="font-mono"
                    />
                  </p>
                  <ProgressBar value={selectedPoolPercent} color="rose" className="mt-3" />
                </div>
              </dd>
            </div>
          </dl>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return <Loading />
  }

  if (isError) {
    return <div>Error</div>
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-start justify-between gap-x-2">
            <span>Staking Details</span>
            {poolsInfo.length > 0 && (
              <Select value={selectedPool} onValueChange={setSelectedPool}>
                <SelectTrigger className="-my-2.5 w-[120px]">
                  <SelectValue placeholder="Select a pool" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Pools</SelectItem>
                  {poolsInfo.map((_, index) => (
                    <SelectItem key={index} value={String(index)}>
                      {getPoolNameFromIndex(index)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="mt-2.5 space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="flex items-center justify-center">
              {poolData.filter((data) => data.value > 0).length > 0 ? (
                <PoolsChart
                  data={poolData}
                  onValueChange={handlePoolClick}
                  className="w-52 h-52 sm:w-64 sm:h-64"
                />
              ) : (
                <div className="flex items-center justify-center w-52 h-52 sm:w-64 sm:h-64 rounded-tremor-default border border-tremor-border dark:border-dark-tremor-border">
                  <span className="text-sm text-muted-foreground">No data</span>
                </div>
              )}
            </div>
            <div className="flex items-center">{renderPoolInfo()}</div>
          </div>
          {chartData.length > 0 && (
            <ScrollArea
              className={cn('rounded-lg border', {
                'h-64': chartData.length > 6,
                'sm:h-96': chartData.length > 9,
              })}
            >
              <div className="p-2 pr-6">
                <BarList
                  data={chartData}
                  valueFormatter={valueFormatter}
                  className="font-mono"
                  showAnimation
                />
              </div>
            </ScrollArea>
          )}
        </CardContent>
        <CardFooter className="mt-4 flex justify-end gap-x-2">
          <Button onClick={() => setAddStakeValidator(validator)} disabled={stakingDisabled}>
            Add Stake
          </Button>
          <Button
            variant="secondary"
            onClick={() => setUnstakeValidator(validator)}
            disabled={unstakingDisabled}
          >
            Unstake
          </Button>
        </CardFooter>
      </Card>

      <AddStakeModal
        validator={addStakeValidator}
        setValidator={setAddStakeValidator}
        stakesByValidator={stakesByValidator}
        constraints={constraints}
      />
      <UnstakeModal
        validator={unstakeValidator}
        setValidator={setUnstakeValidator}
        stakesByValidator={stakesByValidator}
      />
    </>
  )
}
