import { Link } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet'
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from '@/components/ui/navigation-menu'
import { cn } from '@/utils/ui'

interface NavigationProps {
  showHome?: boolean
  orientation?: 'horizontal' | 'vertical'
}

export function Navigation({ showHome = false, orientation = 'horizontal' }: NavigationProps) {
  const { activeAddress } = useWallet()

  return (
    <NavigationMenu orientation={orientation}>
      <NavigationMenuList
        className={cn(orientation === 'vertical' ? 'flex-col items-start space-x-0 gap-y-1' : '')}
      >
        {showHome && (
          <NavigationMenuItem>
            <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
              <Link to="/" className="[&.active]:font-bold">
                Home
              </Link>
            </NavigationMenuLink>
          </NavigationMenuItem>
        )}

        {!!activeAddress && (
          <>
            <NavigationMenuItem>
              <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
                <Link
                  to="/add"
                  className="[&.active]:font-bold [&.active]:bg-accent/50 [&.active]:hover:bg-accent"
                >
                  Add Validator
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
          </>
        )}
      </NavigationMenuList>
    </NavigationMenu>
  )
}
