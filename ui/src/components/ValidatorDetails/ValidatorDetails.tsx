import { Details } from '@/components/ValidatorDetails/Details'
import { Highlights } from '@/components/ValidatorDetails/Highlights'
import { StakeChart } from '@/components/ValidatorDetails/StakeChart'
import { StakersChart } from '@/components/ValidatorDetails/StakersChart'
import { Constraints, Validator } from '@/interfaces/validator'

interface ValidatorDetailsProps {
  validator: Validator
  constraints: Constraints
}

export function ValidatorDetails({ validator, constraints }: ValidatorDetailsProps) {
  return (
    <div className="py-10 space-y-4">
      <Highlights validator={validator} constraints={constraints} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <Details validator={validator} />
        </div>
        <div className="space-y-4 lg:col-span-2">
          <StakeChart validator={validator} />
          <StakersChart validator={validator} />
        </div>
      </div>
    </div>
  )
}
