import { ValidatorPoolKey } from './validator'

export interface StakedInfo {
  account: string
  balance: bigint
  totalRewarded: bigint
  rewardTokenBalance: bigint
  entryRound: bigint
}

export interface StakerPoolData extends StakedInfo {
  poolKey: ValidatorPoolKey
  lastPayout: bigint
}

export interface StakerValidatorData {
  validatorId: number
  balance: bigint
  totalRewarded: bigint
  rewardTokenBalance: bigint
  entryRound: bigint
  lastPayout: bigint
  pools: Array<StakerPoolData>
}
