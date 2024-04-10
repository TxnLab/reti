import { Link } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet-react'
import { Menu, FlaskConical, Home, Monitor } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetTrigger } from '@/components/ui/sheet'

export function MobileMenu() {
  const { activeAddress } = useWallet()
  const isDevelopment = import.meta.env.VITE_ALGOD_NETWORK === 'localnet'

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="shrink-0 md:hidden">
          <Menu className="h-6 w-6" />
          <span className="sr-only">Toggle navigation menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left">
        <nav className="grid gap-6 text-lg font-medium">
          <SheetClose asChild>
            <Link to="/" className="flex items-center gap-2 text-lg font-semibold">
              <Logo wordMark className="h-9 w-auto" />
              <span className="sr-only">Réti Pooling</span>
            </Link>
          </SheetClose>
          <SheetClose asChild>
            <Link
              to="/"
              className="flex items-center gap-4 px-2.5 text-muted-foreground hover:text-foreground [&.active]:text-foreground"
            >
              <Home className="h-5 w-5" />
              Dashboard
            </Link>
          </SheetClose>

          {activeAddress && (
            <>
              <SheetClose asChild>
                <Link
                  to="/add"
                  className="flex items-center gap-4 px-2.5 text-muted-foreground hover:text-foreground [&.active]:text-foreground"
                >
                  <Monitor className="h-5 w-5" />
                  Add Validator
                </Link>
              </SheetClose>

              {isDevelopment && (
                <SheetClose asChild>
                  <Link
                    to="/token"
                    className="flex items-center gap-4 px-2.5 text-muted-foreground hover:text-foreground [&.active]:text-foreground"
                  >
                    <FlaskConical className="h-5 w-5" />
                    Create Token
                  </Link>
                </SheetClose>
              )}
            </>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  )
}
