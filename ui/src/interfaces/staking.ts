import { ValidatorPoolKey } from './validator'

export interface StakedInfo {
  account: string
  balance: bigint
  totalRewarded: bigint
  rewardTokenBalance: bigint
  entryTime: number
}

export interface StakerPoolData extends StakedInfo {
  poolKey: ValidatorPoolKey
}

export interface StakerValidatorData {
  validatorId: number
  balance: bigint
  totalRewarded: bigint
  rewardTokenBalance: bigint
  entryTime: number
  pools: Array<StakerPoolData>
}
