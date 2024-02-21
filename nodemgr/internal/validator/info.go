package validator

const (
	MaxNodes        = 12
	MaxPoolsPerNode = 6
	MaxPools        = MaxNodes * MaxPoolsPerNode
)

type ValidatorInfo struct {
	ID         int    // ID of this validator (sequentially assigned)
	Owner      string // Account that controls config - presumably cold-wallet
	Manager    string // Account that triggers/pays for payouts and keyreg transactions - needs to be hotwallet as node has to sign for the transactions
	NFDForInfo uint64 // Optional NFD AppID which the validator uses to describe their validator pool
	Config     ValidatorConfig
	State      ValidatorCurState
	Pools      [MaxPools]PoolInfo
}

type ValidatorConfig struct {
	PayoutEveryXDays           int    // Payout frequency - ie: 7, 30, etc.
	PercentToValidator         int    // Payout percentage expressed w/ four decimals - ie: 50000 = 5% -> .0005 -
	ValidatorCommissionAddress string // account that receives the validation commission each epoch payout (can be ZeroAddress)
	MinAllowedStake            uint64 // minimum stake required to enter pool - but must withdraw all if want to go below this amount as well(!)
	MaxAlgoPerPool             uint64 // maximum stake allowed per pool (to keep under incentive limits)
	PoolsPerNode               int    // Number of pools to allow per node (max of 3 is recommended)
}

type ValidatorCurState struct {
	NumPools        int    // current number of pools this validator has - capped at MaxPools
	TotalStakers    uint64 // total number of stakers across all pools
	TotalAlgoStaked uint64 // total amount staked to this validator across ALL of its pools
}

type PoolInfo struct {
	NodeID          int
	PoolAppID       uint64 // The App ID of this staking pool contract instance
	TotalStakers    int
	TotalAlgoStaked uint64
}
