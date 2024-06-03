import { Link } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet-react'
import { Connect } from '@/components/Connect'
import { ConnectedMenu } from '@/components/ConnectedMenu'
import { Footer } from '@/components/Footer'
import { GitHub } from '@/components/GitHub'
import { Logo } from '@/components/Logo'
import { MobileMenu } from '@/components/MobileMenu'
import { ModeToggle } from '@/components/ModeToggle'
import { Navigation } from '@/components/Navigation'
import { Badge } from '@/components/ui/badge'

interface LayoutProps {
  title?: string
  children: React.ReactNode
}

export function Layout({ children }: LayoutProps) {
  const { activeAddress } = useWallet()

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 justify-between">
            <div className="flex">
              <div className="-ml-2 mr-3 flex items-center lg:hidden">
                <MobileMenu />
              </div>
              <div className="flex flex-shrink-0 items-center">
                <Link
                  to="/"
                  activeOptions={{ exact: true }}
                  className="flex items-center gap-x-2 sm:gap-x-3"
                >
                  <Logo className="h-8 w-auto sm:hidden" />
                  <Logo wordMark className="hidden h-8 w-auto sm:block" />
                  <Badge className="px-1.5 capitalize pointer-events-none">
                    {import.meta.env.VITE_ALGOD_NETWORK}
                  </Badge>
                </Link>
              </div>
              <div className="hidden lg:ml-8 lg:flex lg:items-center lg:space-x-4">
                <Navigation />
              </div>
            </div>
            <div className="flex items-center gap-x-2">
              <div className="flex-shrink-0">
                {activeAddress ? <ConnectedMenu activeAddress={activeAddress} /> : <Connect />}
              </div>
              <GitHub className="hidden sm:flex" />
              <ModeToggle className="hidden sm:flex" />
            </div>
          </div>
        </div>
      </nav>

      {children}

      <Footer />
    </div>
  )
}
