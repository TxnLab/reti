import * as React from 'react'
import { Validator } from '@/interfaces/validator'
import { ExplorerLink } from '@/utils/explorer'
import { cn } from '@/utils/ui'

interface RewardTokenProps {
  validator?: Validator | null
  show?: 'name' | 'unit-name' | 'full'
  link?: boolean
  fallback?: React.ReactNode
  className?: string
}

export function RewardToken({
  validator,
  show = 'unit-name',
  link = false,
  fallback = <span className="text-muted-foreground">--</span>,
  className = '',
}: RewardTokenProps) {
  const renderUnitName = (unitName: string) => {
    return <span className="font-mono">{unitName}</span>
  }

  const renderRewardToken = (validator: Validator) => {
    const { rewardToken } = validator

    if (!rewardToken) {
      return validator.config.rewardTokenId
    }

    const { name, 'unit-name': unitName } = rewardToken.params

    if (unitName && show === 'unit-name') {
      return renderUnitName(unitName)
    }

    if (name && show === 'name') {
      return name
    }

    if (show === 'full') {
      if (name && unitName) {
        return (
          <>
            {name} ({renderUnitName(unitName)})
          </>
        )
      } else if (name) {
        return name
      } else if (unitName) {
        return renderUnitName(unitName)
      }
    }

    if (unitName) {
      return renderUnitName(unitName)
    }

    return validator.config.rewardTokenId
  }

  if (!validator?.config.rewardTokenId) {
    return fallback
  }

  if (link) {
    return (
      <a
        href={ExplorerLink.asset(validator.config.rewardTokenId)}
        rel="noreferrer"
        target="_blank"
        className={cn('text-link text-foreground', className)}
      >
        {renderRewardToken(validator)}
      </a>
    )
  }

  return <span className={className}>{renderRewardToken(validator)}</span>
}
