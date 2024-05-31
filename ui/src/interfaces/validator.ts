import { Asset } from '@/interfaces/algod'
import { Nfd } from '@/interfaces/nfd'
import { ToStringTypes } from '@/interfaces/utils'

export type RawValidatorConfig = [
  bigint,
  string,
  string,
  bigint,
  number | bigint,
  string,
  [bigint, bigint, bigint, bigint],
  bigint,
  bigint,
  bigint,
  number | bigint,
  number | bigint,
  string,
  bigint,
  bigint,
  number | bigint,
  bigint,
  bigint,
]

export type EntryGatingAssets = [number, number, number, number]

export interface ValidatorConfig {
  id: number // id of this validator (sequentially assigned)
  owner: string // account that controls config - presumably cold-wallet
  manager: string // account that triggers/pays for payouts and keyreg transactions - needs to be hotwallet as node has to sign for the transactions
  nfdForInfo: number
  entryGatingType: number
  entryGatingAddress: string
  entryGatingAssets: EntryGatingAssets
  gatingAssetMinBalance: bigint
  rewardTokenId: number
  rewardPerPayout: bigint
  epochRoundLength: number // Epoch length in rounds
  percentToValidator: number // Payout percentage expressed w/ four decimals - ie: 50000 = 5% -> .0005 -
  validatorCommissionAddress: string // account that receives the validation commission each epoch payout (can be ZeroAddress)
  minEntryStake: bigint // minimum stake required to enter pool - but must withdraw all if they want to go below this amount as well(!)
  maxAlgoPerPool: bigint // maximum stake allowed per pool (to keep under incentive limits)
  poolsPerNode: number // Number of pools to allow per node (max of 3 is recommended)
  sunsettingOn: number // timestamp when validator will sunset (if != 0)
  sunsettingTo: number // validator id that validator is 'moving' to (if known)
}

export type ValidatorConfigInput = Omit<
  ToStringTypes<ValidatorConfig>,
  'id' | 'maxAlgoPerPool' | 'sunsettingOn' | 'sunsettingTo'
>

export type RawValidatorState = [number | bigint, bigint, bigint, bigint]

export interface ValidatorState {
  numPools: number // current number of pools this validator has - capped at MaxPools
  totalStakers: number // total number of stakers across all pools
  totalAlgoStaked: bigint // total amount staked to this validator across ALL of its pools
  rewardTokenHeldBack: bigint // amount of token held back for future payout to stakers
}

export type RawPoolsInfo = [bigint, number, bigint][]

export interface PoolInfo {
  poolId: number
  poolAppId: number
  totalStakers: number
  totalAlgoStaked: bigint
  poolAddress?: string
  algodVersion?: string
}

export type NodeConfig = [bigint, ...bigint[]]
export type RawNodePoolAssignmentConfig = [[NodeConfig][]]
export type NodePoolAssignmentConfig = NodeConfig[]

export type NodeInfo = {
  index: number
  availableSlots: number
}

export type Validator = {
  id: number
  config: Omit<ValidatorConfig, 'id'>
  state: ValidatorState
  pools: PoolInfo[]
  nodePoolAssignment: NodePoolAssignmentConfig
  rewardToken?: Asset
  gatingAssets?: Asset[]
  nfd?: Nfd
  apy?: number
}

export interface ValidatorPoolKey {
  poolId: number
  poolAppId: number
  validatorId: number
}

export interface FindPoolForStakerResponse {
  poolKey: ValidatorPoolKey
  isNewStakerToValidator: boolean
  isNewStakerToProtocol: boolean
}

export interface MbrAmounts {
  validatorMbr: number
  poolMbr: number
  poolInitMbr: number
  stakerMbr: number
}

export type RawConstraints = [
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
]

export interface Constraints {
  payoutRoundsMin: number
  payoutRoundsMax: number
  commissionPctMin: number
  commissionPctMax: number
  minEntryStake: bigint
  maxAlgoPerPool: bigint
  maxAlgoPerValidator: bigint
  saturationThreshold: bigint
  maxNodes: number
  maxPoolsPerNode: number
  maxStakersPerPool: number
}
