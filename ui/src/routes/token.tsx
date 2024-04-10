import { createFileRoute } from '@tanstack/react-router'
import { CreateTokenForm } from '@/components/CreateTokenForm'
import { Meta } from '@/components/Meta'
import { PageHeader } from '@/components/PageHeader'
import { PageMain } from '@/components/PageMain'

const pageTitle = 'Create Token'
const pageDescription = 'Create a new Algorand Standard Asset (ASA) for rewards/gating.'

export const Route = createFileRoute('/token')({
  component: CreateToken,
})

function CreateToken() {
  return (
    <>
      <Meta title={pageTitle} />
      <PageHeader title={pageTitle} description={pageDescription} />
      <PageMain>
        <CreateTokenForm />
      </PageMain>
    </>
  )
}
