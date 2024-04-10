import { Link } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet-react'
import { FlaskConical } from 'lucide-react'

export function Navigation() {
  const { activeAddress } = useWallet()
  const isDevelopment = import.meta.env.VITE_ALGOD_NETWORK === 'localnet'

  return (
    <nav className="hidden flex-col gap-6 text-lg font-medium md:flex md:flex-row md:items-center md:gap-5 md:text-sm lg:gap-6">
      {activeAddress && (
        <>
          <Link
            to="/add"
            className="text-muted-foreground transition-colors hover:text-foreground [&.active]:text-foreground"
          >
            Add Validator
          </Link>
          {isDevelopment && (
            <Link
              to="/token"
              className="inline-flex items-center text-muted-foreground transition-colors hover:text-foreground [&.active]:text-foreground"
            >
              <FlaskConical className="h-4 w-4 mr-1.5 opacity-75" />
              Create Token
            </Link>
          )}
        </>
      )}
    </nav>
  )
}
