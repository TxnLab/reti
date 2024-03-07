import { Navigate, createFileRoute, redirect } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet'
import { validatorQueryOptions } from '@/api/contracts'
import { PageHeader } from '@/components/PageHeader'
import { PageMain } from '@/components/PageMain'
import { ValidatorDetails } from '@/components/ValidatorDetails'
import { isWalletConnected } from '@/utils/wallets'

export const Route = createFileRoute('/validators/$validatorId')({
  beforeLoad: async () => {
    if (!isWalletConnected()) {
      throw redirect({
        to: '/',
      })
    }
  },
  loader: ({ context: { queryClient }, params: { validatorId } }) =>
    queryClient.ensureQueryData(validatorQueryOptions(validatorId)),
  component: Dashboard,
  pendingComponent: () => <div>Loading...</div>,
  errorComponent: ({ error }) => {
    if (error instanceof Error) {
      return <div>{error?.message}</div>
    }
    return <div>Error loading validator</div>
  },
})

function Dashboard() {
  const validator = Route.useLoaderData()

  const { activeAddress, isReady } = useWallet()

  if (isReady && !activeAddress) {
    return <Navigate to="/" />
  }

  return (
    <>
      <PageHeader title={`Validator ${validator.id}`} />
      <PageMain>
        <ValidatorDetails validator={validator} />
      </PageMain>
    </>
  )
}
