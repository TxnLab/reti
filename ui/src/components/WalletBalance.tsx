import { useQuery } from '@tanstack/react-query'
import { balanceQueryOptions } from '@/api/queries'
import { AlgoDisplayAmount } from '@/components/AlgoDisplayAmount'

interface WalletBalanceProps {
  activeAddress: string
}

export function WalletBalance({ activeAddress }: WalletBalanceProps) {
  const { data: balance, isLoading, error } = useQuery(balanceQueryOptions(activeAddress))

  if (isLoading) {
    return <span className="text-sm">Loading...</span>
  }

  if (error || !balance) {
    return <span className="text-sm text-red-500">Error fetching balance</span>
  }

  return (
    <div className="space-y-1">
      <p className="text-sm font-medium leading-none">Account Balance</p>
      <p className="text-sm text-muted-foreground font-mono">
        <AlgoDisplayAmount amount={balance.available.algos} mutedRemainder />
      </p>
    </div>
  )
}
