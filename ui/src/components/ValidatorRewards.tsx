import { Validator } from '@/interfaces/validator'
import { useQuery } from '@tanstack/react-query'
import { getAccountBalance } from '@/api/algod'
import { getApplicationAddress } from 'algosdk'
import { AlgoDisplayAmount } from '@/components/AlgoDisplayAmount'

async function fetchTotalBalances(validator: Validator) {
  try {
    let totalBalances = 0
    for (const pool of validator.pools) {
      const poolBal = await getAccountBalance(getApplicationAddress(pool.poolAppId), true)
      totalBalances += poolBal
    }
    return totalBalances - Number(validator.state.totalAlgoStaked)
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
    queryFn: () => fetchTotalBalances(validator),
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
