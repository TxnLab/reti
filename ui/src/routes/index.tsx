import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet-react'
import { fetchStakerValidatorData } from '@/api/contracts'
import { constraintsQueryOptions, validatorsQueryOptions } from '@/api/queries'
import { Loading } from '@/components/Loading'
import { Meta } from '@/components/Meta'
import { PageHeader } from '@/components/PageHeader'
import { PageMain } from '@/components/PageMain'
import { StakingTable } from '@/components/StakingTable'
import { ValidatorTable } from '@/components/ValidatorTable'
import { StakerValidatorData } from '@/interfaces/staking'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    return {
      validatorsQueryOptions,
      constraintsQueryOptions,
    }
  },
  loader: async ({ context: { queryClient, validatorsQueryOptions, constraintsQueryOptions } }) => {
    queryClient.ensureQueryData(validatorsQueryOptions)
    queryClient.ensureQueryData(constraintsQueryOptions)
  },
  component: Dashboard,
  pendingComponent: () => <Loading size="lg" className="opacity-50" />,
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

  const constraintsQuery = useSuspenseQuery(constraintsQueryOptions)
  const constraints = constraintsQuery.data

  const { activeAddress } = useWallet()

  const stakesQuery = useQuery<StakerValidatorData[]>({
    queryKey: ['stakes', { staker: activeAddress! }],
    queryFn: () => fetchStakerValidatorData(activeAddress!),
    enabled: !!activeAddress,
    retry: false,
  })

  const stakesByValidator = stakesQuery.data || []

  return (
    <>
      <Meta title="Dashboard" />
      <PageHeader
        title="Staking Dashboard"
        description="Browse validators in the protocol and manage your staking activity."
      />
      <PageMain>
        <div className="space-y-8">
          <StakingTable
            validators={validators || []}
            stakesByValidator={stakesByValidator}
            isLoading={stakesQuery.isLoading}
            constraints={constraints}
          />
          <ValidatorTable
            validators={validators || []}
            stakesByValidator={stakesByValidator}
            constraints={constraints}
          />
        </div>
      </PageMain>
    </>
  )
}
