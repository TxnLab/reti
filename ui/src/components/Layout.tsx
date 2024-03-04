import { useWallet } from '@txnlab/use-wallet'
import { Crown } from 'lucide-react'
import { MobileMenu } from '@/components/MobileMenu'
import { ModeToggle } from '@/components/ModeToggle'
import { ConnectedMenu } from '@/components/ConnectedMenu'
import { Connect } from '@/components/Connect'

interface LayoutProps {
  title?: string
  children: React.ReactNode
}

export function Layout({ title, children }: LayoutProps) {
  const { activeAddress } = useWallet()

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
                <Crown className="h-8 w-auto" />
              </div>
              <div className="hidden md:ml-6 md:flex md:items-center md:space-x-4">
                {/* <NavigationMenu>
                  <NavigationMenuList>
                    <NavigationMenuItem>
                      <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                        Documentation
                      </NavigationMenuLink>
                    </NavigationMenuItem>
                  </NavigationMenuList>
                </NavigationMenu> */}
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

      <div className="py-10">
        {title && (
          <header>
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <h1 className="text-3xl font-bold leading-tight tracking-tight text-stone-900 dark:text-white">
                {title}
              </h1>
            </div>
          </header>
        )}
        <main>
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="py-10">{children}</div>
          </div>
        </main>
      </div>
    </div>
  )
}
