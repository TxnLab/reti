import { GitHubLogoIcon } from '@radix-ui/react-icons'
import { Link } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet-react'
import { Menu, Home, Monitor, Book, HandCoins } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { ModeToggleMobile } from '@/components/ModeToggleMobile'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetTrigger } from '@/components/ui/sheet'

export function MobileMenu() {
  const { activeAddress } = useWallet()
  const isTestnet = import.meta.env.VITE_ALGOD_NETWORK === 'testnet'

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="shrink-0 lg:hidden">
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
            <SheetClose asChild>
              <Link
                to="/add"
                className="flex items-center gap-4 px-2.5 text-muted-foreground hover:text-foreground [&.active]:text-foreground"
              >
                <Monitor className="h-5 w-5" />
                Add Validator
              </Link>
            </SheetClose>
          )}

          {isTestnet && (
            <SheetClose asChild>
              <a
                href="https://bank.testnet.algorand.network/"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3.5 px-2.5 text-muted-foreground hover:text-foreground"
              >
                <HandCoins className="h-6 w-6" />
                Dispenser
              </a>
            </SheetClose>
          )}

          <SheetClose asChild>
            <a
              href="https://txnlab.gitbook.io/reti-open-pooling"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3.5 px-2.5 text-muted-foreground hover:text-foreground"
            >
              <Book className="h-6 w-6" />
              Documentation
            </a>
          </SheetClose>

          <SheetClose asChild>
            <a
              href="https://github.com/TxnLab/reti"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-4 px-2.5 text-muted-foreground hover:text-foreground"
            >
              <GitHubLogoIcon className="mr-0.5 h-5 w-5" />
              GitHub
            </a>
          </SheetClose>

          <ModeToggleMobile />
        </nav>
      </SheetContent>
    </Sheet>
  )
}
