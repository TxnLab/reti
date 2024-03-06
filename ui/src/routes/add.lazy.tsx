import { createLazyFileRoute } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet'
import { PageHeader } from '@/components/PageHeader'
import { PageMain } from '@/components/PageMain'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AddForm } from '@/components/AddForm'

export const Route = createLazyFileRoute('/add')({
  component: AddValidator,
})

function AddValidator() {
  const { providers, activeAddress, isReady } = useWallet()

  return (
    <>
      <PageHeader title={activeAddress ? 'Add a Validator' : null} />
      <PageMain>
        {activeAddress ? (
          <div className="py-10">
            <AddForm />
          </div>
        ) : isReady ? (
          <div className="flex items-center justify-center h-96">
            <Card className="w-[350]">
              <CardHeader>
                <CardTitle>Connect your wallet</CardTitle>
                <CardDescription>
                  Connect your wallet to access your account and manage delegations.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 py-4">
                  {providers?.map((provider) => (
                    <Button
                      key={provider.metadata.id}
                      variant="secondary"
                      onClick={() => provider.connect()}
                      className="w-full"
                    >
                      {provider.metadata.name}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div>Loading...</div>
        )}
      </PageMain>
    </>
  )
}
