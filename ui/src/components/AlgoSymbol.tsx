import { cn } from '@/utils/ui'

export function AlgoSymbol({
  className = '',
  verticalOffset = -1,
  characterOffset = 0.5,
  sizePercent = 70,
}) {
  return (
    <span
      className={cn('font-algo relative', className)}
      style={{
        fontSize: `${sizePercent}%`,
        top: `${verticalOffset}px`,
        marginRight: `${characterOffset}ch`,
      }}
    >
      A
    </span>
  )
}
