import { PopoverContentProps } from '@radix-ui/react-popover'
import { CircleHelp } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/utils/ui'

interface InfoPopoverProps extends PopoverContentProps {
  children?: React.ReactNode
  className?: string
  label: string
}

export function InfoPopover({ children, className, label, ...contentProps }: InfoPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger
        className={cn('text-muted-foreground hover:text-foreground', className)}
        aria-label={`Info: ${label}`}
      >
        <CircleHelp className="h-4 w-4 sm:h-3 sm:w-3" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        sideOffset={8}
        className="text-sm"
        role="tooltip"
        {...contentProps}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}
