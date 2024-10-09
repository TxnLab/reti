import { useQueries, useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { stakedInfoQueryOptions, validatorPoolsQueryOptions } from '@/api/queries'
import { ExplorerLink } from '@/utils/explorer'
import { StakedInfo } from '@/contracts/StakingPoolClient'

interface UseChartDataProps {
  selectedPool: string
  validatorId: number
}

export function useStakersChartData({ selectedPool, validatorId }: UseChartDataProps) {
  const poolsInfoQuery = useQuery(validatorPoolsQueryOptions(validatorId))
  const poolsInfo = poolsInfoQuery.data || []

  const allStakedInfo = useQueries({
    queries: poolsInfo.map((pool) => stakedInfoQueryOptions(pool.poolAppId)),
  })

  const isLoading = poolsInfoQuery.isLoading || allStakedInfo.some((query) => query.isLoading)
  const isSuccess = poolsInfoQuery.isSuccess && allStakedInfo.every((query) => query.isSuccess)
  const isError = poolsInfoQuery.isError || allStakedInfo.some((query) => query.isError)

  const defaultMessage = isError ? 'An error occurred while loading staking data.' : undefined

  const errorMessage =
    poolsInfoQuery.error?.message ||
    allStakedInfo.find((query) => query.error)?.error?.message ||
    defaultMessage

  const stakersChartData = React.useMemo(() => {
    if (!allStakedInfo) {
      return []
    }

    const stakerTotals: Record<string, StakedInfo> = {}

    allStakedInfo.forEach((query, i) => {
      if (selectedPool !== 'all' && Number(selectedPool) !== i) {
        return
      }

      const stakers = query.data || []

      stakers.forEach((staker) => {
        const id = staker.account

        if (!stakerTotals[id]) {
          stakerTotals[id] = {
            ...staker,
            balance: BigInt(0),
            totalRewarded: BigInt(0),
            rewardTokenBalance: BigInt(0),
          }
        }
        stakerTotals[id].balance += staker.balance
        stakerTotals[id].totalRewarded += staker.totalRewarded
        stakerTotals[id].rewardTokenBalance += staker.rewardTokenBalance
      })
    })

    return Object.values(stakerTotals).map((staker) => ({
      name: staker.account,
      value: Number(staker.balance),
      href: ExplorerLink.account(staker.account),
    }))
  }, [allStakedInfo, selectedPool])

  return {
    stakersChartData,
    poolsInfo,
    isLoading,
    isError,
    errorMessage,
    isSuccess,
  }
}
