import { Validator } from '@/interfaces/validator'
import { useQuery } from '@tanstack/react-query'
import { getAccountBalance } from '@/api/algod'
import { getApplicationAddress } from 'algosdk'
import { AlgoDisplayAmount } from '@/components/AlgoDisplayAmount'

/**
 * Fetches the total excess balances (rewards) of all pools for a given validator.
 * @param {Validator} validator - The validator object.
 * @return {number} - The total balances rounded to the nearest whole ALGO.
 * @throws {Error} - If an error occurs during the fetch.
 */
async function fetchRewardBalances(validator: Validator) {
  try {
    let totalBalances = 0
    for (const pool of validator.pools) {
      const poolBal = await getAccountBalance(getApplicationAddress(pool.poolAppId), true)
      totalBalances += poolBal
    }
    // Truncate to nearest whole ALGO
    return Math.round((totalBalances - Number(validator.state.totalAlgoStaked)) / 1e6) * 1e6
  } catch (error) {
    console.error(error)
    return 0
  }
}

interface ValidatorRewardsProps {
  validator: Validator
}

export function ValidatorRewards({ validator }: ValidatorRewardsProps) {
  const totalBalancesQuery = useQuery({
    queryKey: ['valrewards', validator.id],
    queryFn: () => fetchRewardBalances(validator),
    refetchInterval: 30000,
  })

  if (totalBalancesQuery.isLoading) {
    return <span>Loading...</span>
  }
  if (totalBalancesQuery.error || totalBalancesQuery.data == undefined) {
    return <span className="text-sm text-red-500">Error fetching balance</span>
  }
  return <AlgoDisplayAmount amount={totalBalancesQuery.data} microalgos />
}
