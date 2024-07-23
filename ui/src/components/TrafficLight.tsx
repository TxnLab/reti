import { Tooltip } from '@/components/Tooltip'
import { Indicator } from '@/constants/indicator'
import { cn } from '@/utils/ui'

interface TrafficLightProps {
  indicator: Indicator
  tooltipContent?: string | Partial<Record<Indicator, string>>
  className?: string
  showGreen?: boolean
}

export function TrafficLight({
  indicator,
  tooltipContent = '',
  className = '',
  showGreen = false,
}: TrafficLightProps) {
  const getClassName = () => {
    switch (indicator) {
      case Indicator.Error:
        return 'bg-red-500'
      case Indicator.Normal:
        return 'bg-green-500'
      case Indicator.Watch:
        return 'bg-yellow-500'
      case Indicator.Warning:
        return 'bg-orange-500'
      case Indicator.Max:
        return 'bg-red-500'
    }
  }

  const getTooltipContent = () => {
    if (typeof tooltipContent === 'string') {
      return tooltipContent
    }

    return tooltipContent[indicator]
  }

  const renderIndicator = () => {
    return <div className={cn('w-2.5 h-2.5 rounded-full', getClassName(), className)} />
  }

  if (indicator === Indicator.Normal && !showGreen) {
    return null
  }

  return (
    <div className="inline-flex items-center justify-center">
      {tooltipContent ? (
        <Tooltip content={getTooltipContent()}>{renderIndicator()}</Tooltip>
      ) : (
        renderIndicator()
      )}
    </div>
  )
}
