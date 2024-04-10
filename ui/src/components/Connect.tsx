import { useWallet } from '@txnlab/use-wallet-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

export function Connect() {
  const { wallets } = useWallet()

  return (
    <Dialog>
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
            <DialogClose key={wallet.id} asChild>
              <Button variant="secondary" onClick={() => wallet.connect()} className="w-full">
                {wallet.metadata.name}
              </Button>
            </DialogClose>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
