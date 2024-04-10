import { Wallet } from 'lucide-react'

interface WalletMetadataProps {
  icon: string
  name: string
}

export function WalletMetadata({ icon, name }: WalletMetadataProps) {
  return (
    <div className="flex items-center gap-x-2">
      {name === 'KMD' ? (
        <Wallet className="h-5 w-5 opacity-50" />
      ) : (
        <img src={icon} alt={name} className="h-5 w-5 rounded" />
      )}
      <span className="text-xs text-muted-foreground font-medium leading-none">{name}</span>
    </div>
  )
}
