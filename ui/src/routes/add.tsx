import { Navigate, createFileRoute, redirect } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet'
import { PageHeader } from '@/components/PageHeader'
import { PageMain } from '@/components/PageMain'
import { AddForm } from '@/components/AddForm'
import { isWalletConnected } from '@/utils/wallets'

export const Route = createFileRoute('/add')({
  beforeLoad: async () => {
    if (!isWalletConnected()) {
      throw redirect({
        to: '/',
      })
    }
  },
  component: AddValidator,
})

function AddValidator() {
  const { activeAddress, isReady } = useWallet()

  if (isReady && !activeAddress) {
    return <Navigate to="/" />
  }

  return (
    <>
      <PageHeader title={activeAddress ? 'Add a Validator' : null} />
      <PageMain>
        {!isReady ? (
          <div>Loading...</div>
        ) : (
          <div className="py-10">
            <AddForm />
          </div>
        )}
      </PageMain>
    </>
  )
}
