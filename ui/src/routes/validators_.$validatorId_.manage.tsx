import { Navigate, createFileRoute, redirect } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet'
import { validatorQueryOptions } from '@/api/contracts'
import { PageHeader } from '@/components/PageHeader'
import { PageMain } from '@/components/PageMain'
import { isWalletConnected } from '@/utils/wallets'

export const Route = createFileRoute('/validators/$validatorId/manage')({
  beforeLoad: async () => {
    if (!isWalletConnected()) {
      throw redirect({
        to: '/',
      })
    }
  },
  loader: ({ context: { queryClient }, params: { validatorId } }) =>
    queryClient.ensureQueryData(validatorQueryOptions(validatorId)),
  component: ManageValidator,
  pendingComponent: () => <div>Loading...</div>,
  errorComponent: ({ error }) => {
    if (error instanceof Error) {
      return <div>{error?.message}</div>
    }
    return <div>Error loading validator</div>
  },
})

function ManageValidator() {
  const validator = Route.useLoaderData()

  const { activeAddress, isReady } = useWallet()

  if (isReady && !activeAddress) {
    return <Navigate to="/" />
  }

  return (
    <>
      <PageHeader title={`Manage Validator ${validator.id}`} />
      <PageMain>
        <div className="py-10">Manage Validator form</div>
      </PageMain>
    </>
  )
}
