import { ErrorComponent, Navigate, createFileRoute, redirect } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet'
import { ValidatorNotFoundError, validatorQueryOptions } from '@/api/contracts'
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
    if (error instanceof ValidatorNotFoundError) {
      return <div>{error.message}</div>
    }
    return <ErrorComponent error={error} />
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
