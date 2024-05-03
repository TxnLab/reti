import * as React from 'react'
import {
  Tooltip as TooltipPrimative,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/utils/ui'

interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  variant?: 'default' | 'primary'
}

export function Tooltip({ content, children, variant = 'default' }: TooltipProps) {
  return (
    <TooltipProvider>
      <TooltipPrimative>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          className={cn(
            variant === 'default'
              ? 'bg-stone-900 text-white font-semibold tracking-tight dark:bg-white dark:text-stone-900'
              : '',
          )}
        >
          {content}
        </TooltipContent>
      </TooltipPrimative>
    </TooltipProvider>
  )
}
