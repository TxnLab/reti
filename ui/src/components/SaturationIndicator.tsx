import { Tooltip } from '@/components/Tooltip'
import { SaturationLevel } from '@/constants/saturation'
import { Constraints, Validator } from '@/interfaces/validator'
import { calculateSaturationPercentage, calculateStakeSaturation } from '@/utils/contracts'
import { cn } from '@/utils/ui'

interface SaturationIndicatorProps {
  validator: Validator
  constraints: Constraints
}

export function SaturationIndicator({ validator, constraints }: SaturationIndicatorProps) {
  const saturationLevel = calculateStakeSaturation(validator, constraints)

  const getClassName = () => {
    switch (saturationLevel) {
      case SaturationLevel.Error:
        return 'bg-red-500'
      case SaturationLevel.Normal:
        return 'bg-green-500'
      case SaturationLevel.Watch:
        return 'bg-yellow-500'
      case SaturationLevel.Warning:
        return 'bg-orange-500'
      case SaturationLevel.Max:
        return 'bg-red-500'
    }
  }

  const saturationPercent = calculateSaturationPercentage(validator, constraints)

  return (
    <div className="inline-flex items-center justify-center">
      <Tooltip content={`${saturationPercent}%`}>
        <div className={cn('w-2.5 h-2.5 rounded-full ml-2', getClassName())} />
      </Tooltip>
    </div>
  )
}
