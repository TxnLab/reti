import { ValidatorPoolKey } from './validator'

export interface StakedInfo {
  account: string
  balance: number
  totalRewarded: number
  rewardTokenBalance: number
  entryTime: number
}

export interface StakerPoolData extends StakedInfo {
  poolKey: ValidatorPoolKey
}

export interface StakerValidatorData {
  validatorId: number
  balance: number
  totalRewarded: number
  rewardTokenBalance: number
  entryTime: number
  pools: Array<StakerPoolData>
}
