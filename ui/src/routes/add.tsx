import { useSuspenseQuery } from '@tanstack/react-query'
import { Navigate, createFileRoute, redirect } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet-react'
import { constraintsQueryOptions } from '@/api/queries'
import { Meta } from '@/components/Meta'
import { PageHeader } from '@/components/PageHeader'
import { PageMain } from '@/components/PageMain'
import { AddValidatorForm } from '@/components/AddValidatorForm'

export const Route = createFileRoute('/add')({
  beforeLoad: ({ context }) => {
    if (!context.walletManager.activeAddress) {
      throw redirect({
        to: '/',
      })
    }
  },
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(constraintsQueryOptions),
  component: AddValidator,
  pendingComponent: () => <div>Loading...</div>,
  errorComponent: ({ error }) => {
    if (error instanceof Error) {
      return <div>{error?.message}</div>
    }
    return <div>Error loading protocol constraints</div>
  },
})

function AddValidator() {
  const constraintsQuery = useSuspenseQuery(constraintsQueryOptions)
  const constraints = constraintsQuery.data

  const { activeAddress } = useWallet()

  if (!activeAddress) {
    return <Navigate to="/" />
  }

  return (
    <>
      <Meta title="Add Validator" />
      <PageHeader
        title="Add a Validator"
        description="Create a new validator with the specified configuration."
      />
      <PageMain>
        <AddValidatorForm constraints={constraints} />
      </PageMain>
    </>
  )
}
