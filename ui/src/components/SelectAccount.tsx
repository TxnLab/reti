import { WalletAccount } from '@txnlab/use-wallet-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ellipseAddress } from '@/utils/ellipseAddress'

interface SelectAccountProps {
  accounts: WalletAccount[] | undefined
  activeAccount: WalletAccount | undefined
  onValueChange: (value: string) => void
}

export function SelectAccount({ accounts, activeAccount, onValueChange }: SelectAccountProps) {
  return (
    <Select value={activeAccount?.address} onValueChange={onValueChange}>
      <SelectTrigger className="w-[180px] bg-background/50">
        <SelectValue placeholder="Select account" />
      </SelectTrigger>
      <SelectContent>
        {accounts?.map((account) => (
          <SelectItem key={account.address} value={account.address}>
            {ellipseAddress(account.address)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
