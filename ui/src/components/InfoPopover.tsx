import { PopoverContentProps } from '@radix-ui/react-popover'
import { CircleHelp } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/utils/ui'

interface InfoPopoverProps extends PopoverContentProps {
  children?: React.ReactNode
  className?: string
}

export function InfoPopover({ children, className, ...contentProps }: InfoPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger className={cn('text-muted-foreground hover:text-foreground', className)}>
        <CircleHelp className="h-4 w-4 sm:h-3 sm:w-3" />
      </PopoverTrigger>
      <PopoverContent side="top" sideOffset={8} className="text-sm" {...contentProps}>
        {children}
      </PopoverContent>
    </Popover>
  )
}
