import { Asset } from '@/interfaces/algod'
import { Nfd } from '@/interfaces/nfd'
import { ToStringTypes } from '@/interfaces/utils'
import {
  NodePoolAssignmentConfig,
  ValidatorConfig,
  ValidatorCurState,
  ValidatorPoolKey,
} from '@/contracts/ValidatorRegistryClient'

export type EntryGatingAssets = [bigint, bigint, bigint, bigint]

export type ValidatorConfigInput = Omit<
  ToStringTypes<ValidatorConfig>,
  'id' | 'maxAlgoPerPool' | 'sunsettingOn' | 'sunsettingTo'
>

export interface LocalPoolInfo {
  poolId: bigint
  poolAppId: bigint
  totalStakers: bigint
  totalAlgoStaked: bigint
  poolAddress?: string
  algodVersion?: string
}

export type NodeInfo = {
  index: number
  availableSlots: number
}

export type Validator = {
  id: number
  config: Omit<ValidatorConfig, 'id'>
  state: ValidatorCurState
  pools: LocalPoolInfo[]
  nodePoolAssignment: NodePoolAssignmentConfig
  rewardsBalance?: bigint
  roundsSinceLastPayout?: bigint
  rewardToken?: Asset
  gatingAssets?: Asset[]
  nfd?: Nfd
  apy?: number
}

export interface FindPoolForStakerResponse {
  poolKey: ValidatorPoolKey
  isNewStakerToValidator: boolean
  isNewStakerToProtocol: boolean
}

// export interface MbrAmounts {
//   validatorMbr: number
//   poolMbr: number
//   poolInitMbr: number
//   stakerMbr: number
// }
//
// Used for calculating validator metrics
export type PoolData = {
  balance: bigint
  lastPayout?: bigint
  apy?: bigint
}
