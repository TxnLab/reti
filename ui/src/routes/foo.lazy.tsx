import { createLazyFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/PageHeader'
import { PageMain } from '@/components/PageMain'

export const Route = createLazyFileRoute('/foo')({
  component: Foo,
})

function Foo() {
  return (
    <>
      <PageHeader title="Foo" />
      <PageMain>
        <div className="p-2">Hello from Foo!</div>
      </PageMain>
    </>
  )
}
