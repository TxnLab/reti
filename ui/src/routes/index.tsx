import { Navigate, createFileRoute } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet-react'
import { PageHeader } from '@/components/PageHeader'
import { PageMain } from '@/components/PageMain'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  const { wallets, activeAddress } = useWallet()

  if (activeAddress) {
    return <Navigate to="/dashboard" />
  }

  return (
    <>
      <PageHeader title={activeAddress ? 'Staking Dashboard' : null} />
      <PageMain>
        <div className="flex items-center justify-center py-24">
          <Card className="w-[350]">
            <CardHeader>
              <CardTitle>Connect your wallet</CardTitle>
              <CardDescription>
                Connect your wallet to access your account and manage staking.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 py-4">
                {wallets?.map((wallet) => (
                  <Button
                    key={wallet.id}
                    variant="secondary"
                    onClick={() => wallet.connect()}
                    className="w-full"
                  >
                    {wallet.metadata.name}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </PageMain>
    </>
  )
}
