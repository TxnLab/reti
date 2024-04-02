import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Navigate, createFileRoute, redirect } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet-react'
import { fetchStakerValidatorData } from '@/api/contracts'
import { validatorsQueryOptions } from '@/api/queries'
import { Meta } from '@/components/Meta'
import { PageHeader } from '@/components/PageHeader'
import { PageMain } from '@/components/PageMain'
import { StakingTable } from '@/components/StakingTable'
import { ValidatorTable } from '@/components/ValidatorTable'
import { StakerValidatorData } from '@/interfaces/staking'
import { isWalletConnected } from '@/utils/wallets'

export const Route = createFileRoute('/dashboard')({
  beforeLoad: () => {
    if (!isWalletConnected()) {
      throw redirect({
        to: '/',
      })
    }
  },
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(validatorsQueryOptions),
  component: Dashboard,
  pendingComponent: () => <div>Loading...</div>,
  errorComponent: ({ error }) => {
    if (error instanceof Error) {
      return <div>{error?.message}</div>
    }
    return <div>Error loading validator data</div>
  },
})

function Dashboard() {
  const validatorsQuery = useSuspenseQuery(validatorsQueryOptions)
  const validators = validatorsQuery.data

  const { activeAddress } = useWallet()

  const stakesQuery = useQuery<StakerValidatorData[]>({
    queryKey: ['stakes', { staker: activeAddress! }],
    queryFn: () => fetchStakerValidatorData(activeAddress!),
    enabled: !!activeAddress,
    retry: false,
  })

  const stakesByValidator = stakesQuery.data || []

  if (!activeAddress) {
    return <Navigate to="/" />
  }

  return (
    <>
      <Meta title="Dashboard" />
      <PageHeader title="Staking Dashboard" />
      <PageMain>
        <div className="mt-4 space-y-8">
          <StakingTable
            validators={validators || []}
            stakesByValidator={stakesByValidator}
            isLoading={stakesQuery.isLoading}
          />
          <ValidatorTable validators={validators || []} stakesByValidator={stakesByValidator} />
        </div>
      </PageMain>
    </>
  )
}
