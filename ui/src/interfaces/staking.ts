import { ValidatorPoolKey } from './validator'

export interface StakedInfo {
  account: string
  balance: bigint
  totalRewarded: bigint
  rewardTokenBalance: bigint
  entryRound: number
}

export interface StakerPoolData extends StakedInfo {
  poolKey: ValidatorPoolKey
  lastPayout: number
}

export interface StakerValidatorData {
  validatorId: number
  balance: bigint
  totalRewarded: bigint
  rewardTokenBalance: bigint
  entryTime: number
  lastPayout: number
  pools: Array<StakerPoolData>
}
