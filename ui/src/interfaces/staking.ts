import { ValidatorPoolKey } from './validator'

export interface StakedInfo {
  account: string
  balance: number
  totalRewarded: number
  rewardTokenBalance: number
  entryTime: number
}

export interface ValidatorStake extends StakedInfo {
  poolKey: ValidatorPoolKey
}
