export type ValidatorConfigRaw = [
  bigint,
  string,
  string,
  bigint,
  string,
  bigint,
  bigint,
  bigint,
  number,
  number,
  string,
  bigint,
  bigint,
  number,
  bigint,
  bigint,
]

export interface ValidatorConfig {
  ID: bigint // ID of this validator (sequentially assigned)
  Owner: string // Account that controls config - presumably cold-wallet
  Manager: string // Account that triggers/pays for payouts and keyreg transactions - needs to be hotwallet as node has to sign for the transactions
  NFDForInfo: bigint
  MustHoldCreatorNFT: string
  GatingAssetMinBalance: bigint
  RewardTokenID: bigint
  RewardPerPayout: bigint
  PayoutEveryXMins: number // Payout frequency in minutes (can be no shorter than this)
  PercentToValidator: number // Payout percentage expressed w/ four decimals - ie: 50000 = 5% -> .0005 -
  ValidatorCommissionAddress: string // account that receives the validation commission each epoch payout (can be ZeroAddress)
  MinEntryStake: bigint // minimum stake required to enter pool - but must withdraw all if they want to go below this amount as well(!)
  MaxAlgoPerPool: bigint // maximum stake allowed per pool (to keep under incentive limits)
  PoolsPerNode: number // Number of pools to allow per node (max of 3 is recommended)
  SunsettingOn: bigint // timestamp when validator will sunset (if != 0)
  SunsettingTo: bigint // validator ID that validator is 'moving' to (if known)
}

export type ValidatorStateRaw = [number, bigint, bigint, bigint]

export interface ValidatorState {
  NumPools: number // current number of pools this validator has - capped at MaxPools
  TotalStakers: bigint // total number of stakers across all pools
  TotalAlgoStaked: bigint // total amount staked to this validator across ALL of its pools
  RewardTokenHeldBack: bigint // amount of token held back for future payout to stakers
}

export type Validator = {
  id: number
  owner: string
  manager: string
  nfd: number
  payoutFrequency: number
  commission: number
  commissionAccount: string
  minStake: number
  maxStake: number
  poolsPerNode: number
  sunsetOn: number
  sunsetTo: number
  numPools: number
  numStakers: number
  totalStaked: number
  rewardTokenHeldBack: number
}

export interface MbrAmounts {
  validatorMbr: number
  poolMbr: number
  poolInitMbr: number
  stakerMbr: number
}

export type NodeConfig = [bigint, ...bigint[]]
export type RawNodePoolAssignmentConfig = [[NodeConfig][]]
export type NodePoolAssignmentConfig = NodeConfig[]

export type NodeInfo = {
  index: number
  availableSlots: number
}

export interface ValidatorPoolKey {
  poolId: number
  poolAppId: number
  validatorId: number
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
]

export interface Constraints {
  payoutMinsMin: number
  payoutMinsMax: number
  commissionPctMin: number
  commissionPctMax: number
  minEntryStake: number
  maxAlgoPerPool: number
  maxNodes: number
  maxPoolsPerNode: number
  maxStakersPerPool: number
}

export interface PoolInfo {
  poolAppId: number
  totalStakers: number
  totalAlgoStaked: number
}
