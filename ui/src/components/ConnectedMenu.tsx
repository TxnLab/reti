import { useWallet } from '@txnlab/use-wallet-react'
import { Copy } from 'lucide-react'
import { SelectAccount } from '@/components/SelectAccount'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { WalletBalance } from '@/components/WalletBalance'
import { WalletMetadata } from '@/components/WalletMetadata'
import { copyToClipboard } from '@/utils/copyToClipboard'
import { ellipseAddress } from '@/utils/ellipseAddress'

interface ConnectedMenuProps {
  activeAddress: string
}

export function ConnectedMenu({ activeAddress }: ConnectedMenuProps) {
  const { activeWallet, activeAccount } = useWallet()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className="px-4">
          {ellipseAddress(activeAddress)}
        </Button>
      </DropdownMenuTrigger>
      {activeWallet && activeAccount && (
        <DropdownMenuContent align="end" className="min-w-[16rem]">
          <div className="flex items-center justify-between gap-x-2 px-2 py-1.5 text-sm font-semibold">
            {!!activeWallet && activeWallet.accounts.length > 1 ? (
              <SelectAccount
                accounts={activeWallet.accounts}
                activeAccount={activeAccount}
                onValueChange={activeWallet.setActiveAccount}
              />
            ) : (
              <span>{ellipseAddress(activeAddress)}</span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="group h-8 w-8 -my-1"
              data-clipboard-text={activeAddress}
              onClick={copyToClipboard}
            >
              <Copy className="h-4 w-4 opacity-60 transition-opacity group-hover:opacity-100" />
            </Button>
          </div>
          <DropdownMenuSeparator />
          <div className="px-2 py-3">
            <WalletBalance activeAddress={activeAddress} />
            <Separator className="my-2.5" />
            <WalletMetadata icon={activeWallet.metadata.icon} name={activeWallet.metadata.name} />
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => activeWallet?.disconnect()}>
            Disconnect
            <DropdownMenuShortcut className="hidden lg:inline">⇧D</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  )
}
