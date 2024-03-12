import { Navigate, createFileRoute, redirect } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet'
import { Meta } from '@/components/Meta'
import { PageHeader } from '@/components/PageHeader'
import { PageMain } from '@/components/PageMain'
import { AddValidatorForm } from '@/components/AddValidatorForm'
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
      <Meta title="Add Validator" />
      <PageHeader title={activeAddress ? 'Add a Validator' : null} />
      <PageMain>
        {!isReady ? (
          <div>Loading...</div>
        ) : (
          <div className="py-10">
            <AddValidatorForm />
          </div>
        )}
      </PageMain>
    </>
  )
}
