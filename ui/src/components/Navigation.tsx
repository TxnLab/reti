import { Link } from '@tanstack/react-router'
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from '@/components/ui/navigation-menu'

interface NavigationProps {
  orientation?: 'horizontal' | 'vertical'
}

export function Navigation({ orientation = 'horizontal' }: NavigationProps) {
  return (
    <NavigationMenu orientation={orientation}>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
            <Link to="/add" className="[&.active]:font-bold">
              Add Validator
            </Link>
          </NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  )
}
