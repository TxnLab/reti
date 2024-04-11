import { Moon, Sun } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTheme } from '@/providers/ThemeProvider'
import { cn } from '@/utils/ui'

export function ModeToggleMobile({ className = '' }) {
  const { setTheme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex items-center justify-start gap-x-4 px-2.5 text-lg text-muted-foreground  hover:text-foreground',
          className,
        )}
      >
        <Sun className="h-5 w-5 dark:hidden" />
        <span className="dark:hidden">Light Mode</span>
        <Moon className="hidden h-5 w-5 dark:inline" />
        <span className="hidden dark:inline">Dark Mode</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" alignOffset={35}>
        <DropdownMenuItem onClick={() => setTheme('light')}>Light</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>Dark</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>System</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
