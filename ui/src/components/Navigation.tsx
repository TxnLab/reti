import { Link } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet-react'
import { ArrowUpRight } from 'lucide-react'

export function Navigation() {
  const { activeAddress } = useWallet()
  const isTestnet = import.meta.env.VITE_ALGOD_NETWORK === 'testnet'

  return (
    <nav className="hidden flex-col gap-6 text-lg font-medium md:flex md:flex-row md:items-center md:gap-5 md:text-sm lg:gap-6">
      {activeAddress && (
        <Link
          to="/add"
          className="text-muted-foreground transition-colors hover:text-foreground [&.active]:text-foreground"
        >
          Add Validator
        </Link>
      )}

      {isTestnet && (
        <a
          href="https://bank.testnet.algorand.network/"
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowUpRight className="mr-1 h-5 w-5 opacity-75" />
          Dispenser
        </a>
      )}
    </nav>
  )
}
