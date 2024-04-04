import { Link } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet-react'
import { Connect } from '@/components/Connect'
import { ConnectedMenu } from '@/components/ConnectedMenu'
import { MobileMenu } from '@/components/MobileMenu'
import { ModeToggle } from '@/components/ModeToggle'
import { Navigation } from '@/components/Navigation'
import { useTheme } from '@/providers/ThemeProvider'

interface LayoutProps {
  title?: string
  children: React.ReactNode
}

export function Layout({ children }: LayoutProps) {
  const { activeAddress } = useWallet()
  const { theme } = useTheme()

  return (
    <div className="min-h-full">
      <nav className="border-b border-stone-100 dark:border-stone-900">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 justify-between">
            <div className="flex">
              <div className="-ml-2 mr-2 flex items-center md:hidden">
                <MobileMenu />
              </div>
              <div className="flex flex-shrink-0 items-center">
                <Link to="/" activeOptions={{ exact: true }}>
                  <img
                    src={theme === 'dark' ? '/img/logowhite.svg' : '/img/logoblack.svg'}
                    className="h-8 w-auto"
                  />
                </Link>
              </div>
              <div className="hidden md:ml-6 md:flex md:items-center md:space-x-4">
                <Navigation />
              </div>
            </div>
            <div className="flex items-center gap-x-2">
              <ModeToggle />
              <div className="flex-shrink-0">
                {activeAddress ? <ConnectedMenu activeAddress={activeAddress} /> : <Connect />}
              </div>
            </div>
          </div>
        </div>
      </nav>

      <div className="py-10">{children}</div>
    </div>
  )
}
