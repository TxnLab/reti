import { DisplayAsset } from '@/components/DisplayAsset'
import { useBlockTime } from '@/hooks/useBlockTime'
import { Constraints, Validator } from '@/interfaces/validator'
import { calculateMaxStakers } from '@/utils/contracts'
import { formatDuration } from '@/utils/dayjs'
import { formatAmount, formatAssetAmount } from '@/utils/format'
import { cn } from '@/utils/ui'

interface ValidatorInfoRowProps {
  validator: Validator
  constraints: Constraints
}

export function ValidatorInfoRow({ validator, constraints }: ValidatorInfoRowProps) {
  const blockTime = useBlockTime()

  const epochLength = validator.config.epochRoundLength
  const numRounds = formatAmount(epochLength)
  const durationEstimate = epochLength * blockTime.ms

  const renderRewardPerPayout = () => {
    if (validator.config.rewardPerPayout === 0n) {
      return <span className="text-muted-foreground">--</span>
    }

    if (!validator.rewardToken) {
      return (
        <em className="text-muted-foreground italic">{Number(validator.config.rewardPerPayout)}</em>
      )
    }

    return (
      <span className="font-mono">
        {formatAssetAmount(validator.rewardToken, validator.config.rewardPerPayout, {
          unitName: true,
        })}
      </span>
    )
  }

  return (
    <div
      className={cn(
        'grid gap-5 py-4 px-5 lg:pl-12 lg:py-5',
        validator.config.rewardTokenId === 0 ? 'grid-cols-2' : 'grid-cols-3',
      )}
    >
      <div className="grid gap-5 grid-cols-2">
        <div>
          <h4 className="text-sm font-medium text-muted-foreground">Pools / Max</h4>
          <p className="text-sm">
            <span className="whitespace-nowrap">
              {validator.state.numPools} / {validator.config.poolsPerNode * constraints.maxNodes}
            </span>
          </p>
        </div>
        <div>
          <h4 className="text-sm font-medium text-muted-foreground">Stakers / Max</h4>
          <p className="text-sm">
            <span className="whitespace-nowrap">
              {validator.state.numPools > 0 ? (
                <>
                  {validator.state.totalStakers} / {calculateMaxStakers(validator, constraints)}
                </>
              ) : (
                <>--</>
              )}
            </span>
          </p>
        </div>
      </div>

      <div className="grid gap-5 grid-cols-2">
        <div>
          <h4 className="text-sm font-medium text-muted-foreground">Epoch Length</h4>
          <p className="text-sm">{numRounds} blocks</p>
        </div>
        <div>
          <h4 className="text-sm font-medium text-muted-foreground">Payout Frequency</h4>
          <p className="text-sm">{formatDuration(durationEstimate)}</p>
        </div>
      </div>

      <div
        className={cn('grid gap-5 grid-cols-2', { hidden: validator.config.rewardTokenId === 0 })}
      >
        <div>
          <h4 className="text-sm font-medium text-muted-foreground">Reward Token</h4>
          <p className="text-sm">
            <DisplayAsset asset={validator.rewardToken} show="name" />
          </p>
        </div>
        <div>
          <h4 className="text-sm font-medium text-muted-foreground">Reward Per Payout</h4>
          <p className="text-sm">{renderRewardPerPayout()}</p>
        </div>
      </div>
    </div>
  )
}
