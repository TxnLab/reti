import * as React from 'react'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

export function MobileMenu() {
  const [isOpen, setIsOpen] = React.useState<boolean>(false)

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative p-2 text-stone-400 hover:text-stone-900 dark:text-stone-600 dark:hover:text-white"
        >
          <span className="absolute -inset-0.5" />
          <span className="sr-only">Open main menu</span>
          <Menu className="block h-6 w-6" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="text-left">
        <SheetHeader className="text-left">
          <SheetTitle>Mobile Menu</SheetTitle>
          <SheetDescription>
            This is a placeholder for the mobile menu. It will contain the main navigation and other
            actions.
          </SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  )
}
