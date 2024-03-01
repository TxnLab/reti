import { useWallet } from '@txnlab/use-wallet'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

export function Connect() {
  const [isOpen, setIsOpen] = React.useState<boolean>(false)
  const { providers } = useWallet()

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="px-4">
          Connect
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect</DialogTitle>
          <DialogDescription>
            Connect your wallet to access your account and manage delegations.
          </DialogDescription>
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
  )
}
