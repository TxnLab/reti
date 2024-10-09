import { Details } from '@/components/ValidatorDetails/Details'
import { Highlights } from '@/components/ValidatorDetails/Highlights'
import { StakingDetails } from '@/components/ValidatorDetails/StakingDetails'
import { StakerValidatorData } from '@/interfaces/staking'
import { Validator } from '@/interfaces/validator'
import { Constraints } from '@/contracts/ValidatorRegistryClient'

interface ValidatorDetailsProps {
  validator: Validator
  stakesByValidator: StakerValidatorData[]
  constraints: Constraints
}

export function ValidatorDetails({
  validator,
  constraints,
  stakesByValidator,
}: ValidatorDetailsProps) {
  return (
    <div className="py-10 space-y-4">
      <Highlights validator={validator} constraints={constraints} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <Details validator={validator} />
        </div>
        <div className="space-y-4 lg:col-span-2">
          <StakingDetails
            validator={validator}
            constraints={constraints}
            stakesByValidator={stakesByValidator}
          />
        </div>
      </div>
    </div>
  )
}
