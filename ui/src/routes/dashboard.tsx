import { useSuspenseQuery } from '@tanstack/react-query'
import { Navigate, createFileRoute, redirect } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet'
import { validatorsQueryOptions } from '@/api/contracts'
import { Meta } from '@/components/Meta'
import { PageHeader } from '@/components/PageHeader'
import { PageMain } from '@/components/PageMain'
import { ValidatorTable } from '@/components/ValidatorTable'
import { isWalletConnected } from '@/utils/wallets'

export const Route = createFileRoute('/dashboard')({
  beforeLoad: async () => {
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

  const { activeAddress, isReady } = useWallet()

  if (isReady && !activeAddress) {
    return <Navigate to="/" />
  }

  return (
    <>
      <Meta title="Dashboard" />
      <PageHeader title="Staking Dashboard" />
      <PageMain>
        <ValidatorTable validators={validators} />
      </PageMain>
    </>
  )
}
