import { createLazyFileRoute } from '@tanstack/react-router'
import { ExampleDataTable } from '@/components/ExampleDataTable'
import { PageHeader } from '@/components/PageHeader'
import { PageMain } from '@/components/PageMain'

export const Route = createLazyFileRoute('/')({
  component: Index,
})

function Index() {
  return (
    <>
      <PageHeader title="Dashboard" />
      <PageMain>
        <ExampleDataTable />
      </PageMain>
    </>
  )
}
