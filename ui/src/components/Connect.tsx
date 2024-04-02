import { useWallet } from '@txnlab/use-wallet-react'
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
  const { wallets } = useWallet()

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
            Connect your wallet to access your account and manage staking.
          </DialogDescription>
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
  )
}
