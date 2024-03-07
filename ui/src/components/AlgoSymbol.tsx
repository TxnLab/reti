import { cn } from '@/utils/ui'

export function AlgoSymbol({ className = '' }) {
  return <span className={cn('font-algo relative -top-[1px] text-[70%]', className)}>A</span>
}
