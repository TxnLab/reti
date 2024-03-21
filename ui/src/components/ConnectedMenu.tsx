import { useWallet } from '@txnlab/use-wallet'
import { Copy } from 'lucide-react'
import { SelectAccount } from '@/components/SelectAccount'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { copyToClipboard } from '@/utils/copyToClipboard'
import { ellipseAddress } from '@/utils/ellipseAddress'

interface ConnectedMenuProps {
  activeAddress: string
}

export function ConnectedMenu({ activeAddress }: ConnectedMenuProps) {
  const { providers, activeAccount } = useWallet()

  const provider = providers?.find((p) => p.metadata.id === activeAccount?.providerId)
  const accounts = provider?.accounts

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className="px-4">
          {ellipseAddress(activeAddress)}
        </Button>
      </DropdownMenuTrigger>
      {provider && activeAccount && (
        <DropdownMenuContent align="end" className="w-64">
          <div className="flex items-center justify-between gap-x-2 px-2 py-1.5 text-sm font-semibold">
            {!!accounts && accounts.length > 1 ? (
              <SelectAccount
                accounts={accounts}
                activeAccount={activeAccount}
                onValueChange={provider.setActiveAccount}
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
          <DropdownMenuGroup>
            <DropdownMenuItem>
              Profile
              <DropdownMenuShortcut className="hidden lg:inline">⇧⌘P</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              Withdraw Balance
              <DropdownMenuShortcut className="hidden lg:inline">⌘W</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              Settings
              <DropdownMenuShortcut className="hidden lg:inline">⌘S</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => provider?.disconnect()}>
            Disconnect
            <DropdownMenuShortcut className="hidden lg:inline">⇧⌘Q</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  )
}
