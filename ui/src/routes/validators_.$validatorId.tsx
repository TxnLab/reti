import { ErrorComponent, createFileRoute } from '@tanstack/react-router'
import { ValidatorNotFoundError } from '@/api/contracts'
import { validatorQueryOptions } from '@/api/queries'
import { Loading } from '@/components/Loading'
import { Meta } from '@/components/Meta'
import { PageHeader } from '@/components/PageHeader'
import { PageMain } from '@/components/PageMain'
import { ValidatorDetails } from '@/components/ValidatorDetails'

export const Route = createFileRoute('/validators/$validatorId')({
  loader: ({ context: { queryClient }, params: { validatorId } }) =>
    queryClient.ensureQueryData(validatorQueryOptions(validatorId)),
  component: Dashboard,
  pendingComponent: () => <Loading size="lg" className="opacity-50" />,
  errorComponent: ({ error }) => {
    if (error instanceof ValidatorNotFoundError) {
      return <div>{error.message}</div>
    }
    return <ErrorComponent error={error} />
  },
})

function Dashboard() {
  const validator = Route.useLoaderData()

  return (
    <>
      <Meta title={`Validator ${validator.id}`} />
      <PageHeader title={`Validator ${validator.id}`} />
      <PageMain>
        <ValidatorDetails validator={validator} />
      </PageMain>
    </>
  )
}
