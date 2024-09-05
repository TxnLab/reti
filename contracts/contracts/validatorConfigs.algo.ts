import { MAX_NODES, MAX_POOLS_PER_NODE } from './constants.algo'

export type ValidatorIdType = uint64
export type ValidatorPoolKey = {
    id: ValidatorIdType // 0 is invalid - should start at 1 (but is direct key in box)
    poolId: uint64 // 0 means INVALID ! - so 1 is index, technically of [0]
    poolAppId: uint64
}
export type ValidatorConfig = {
    id: ValidatorIdType // id of this validator (sequentially assigned)
    owner: Address // account that controls config - presumably cold-wallet

    // [CHANGEABLE] account that triggers/pays for payouts and keyreg transactions - needs to be hotwallet as node has to sign
    // for the transactions
    manager: Address

    // [CHANGEABLE] Optional NFD AppID which the validator uses to describe their validator pool
    // NFD must be currently OWNED by address that adds the validator
    nfdForInfo: uint64

    // [CHANGEABLE] entryGatingType / entryGatingValue specifies an optional gating mechanism - whose criteria
    // the staker must meet.
    // It will be the responsibility of the staker (txn composer really) to pick the right thing to check (as argument
    // to adding stake) that meets the criteria if this is set.
    // Allowed types:
    // 1) GATING_TYPE_ASSETS_CREATED_BY: assets created by address X (val is address of creator)
    // 2) GATING_TYPE_ASSET_ID: specific asset id (val is asset id)
    // 3) GATING_TYPE_CREATED_BY_NFD_ADDRESSES: asset in nfd linked addresses (value is nfd appid)
    // 4) GATING_TYPE_SEGMENT_OF_NFD: segment of a particular NFD (value is root appid)
    entryGatingType: uint8
    entryGatingAddress: Address // for GATING_TYPE_ASSETS_CREATED_BY
    entryGatingAssets: StaticArray<uint64, 4> // all checked for GATING_TYPE_ASSET_ID, only first used for GATING_TYPE_CREATED_BY_NFD_ADDRESSES, and GATING_TYPE_SEGMENT_OF_NFD

    // [CHANGEABLE] gatingAssetMinBalance specifies a minimum token base units amount needed of an asset owned by the specified
    // creator (if defined).  If 0, then they need to hold at lest 1 unit, but its assumed this is for tokens, ie: hold
    // 10000[.000000] of token
    gatingAssetMinBalance: uint64

    // Optional reward token info
    // Reward token ASA id: A validator can define a token that users are awarded in addition to
    // the ALGO they receive for being in the pool. This will allow projects to allow rewarding members their own
    // token.  Hold at least 5000 VEST to enter a Vestige staking pool, they have 1 day epochs and all
    // stakers get X amount of VEST as daily rewards (added to stakers ‘available’ balance) for removal at any time.
    rewardTokenId: uint64
    // [CHANGEABLE] Reward rate : Defines the amount of rewardTokenId that is rewarded per epoch across all pools
    // (by their % stake of the validators total)
    rewardPerPayout: uint64

    epochRoundLength: uint32 // Number of rounds per epoch - ie: 30,857 for approx 24hrs w/ 2.8s round times
    percentToValidator: uint32 // Payout percentage expressed w/ four decimals - ie: 50000 = 5% -> .0005 -

    validatorCommissionAddress: Address // [CHANGEABLE] account that receives the validation commission each epoch payout (can be ZeroAddress)
    minEntryStake: uint64 // minimum stake required to enter pool - but must withdraw all if they want to go below this amount as well(!)
    maxAlgoPerPool: uint64 // maximum stake allowed per pool - if validator wants to restrict it.  0 means to use 'current' limits.
    poolsPerNode: uint8 // Number of pools to allow per node (max of 3 is recommended)

    sunsettingOn: uint64 // [CHANGEABLE] timestamp when validator will sunset (if != 0)
    sunsettingTo: ValidatorIdType // [CHANGEABLE] validator id that validator is 'moving' to (if known)
}
export type ValidatorCurState = {
    numPools: uint16 // current number of pools this validator has - capped at MaxPools
    totalStakers: uint64 // total number of stakers across all pools of THIS validator
    totalAlgoStaked: uint64 // total amount staked to this validator across ALL of its pools
    // amount of the reward token held back in pool 1 for paying out stakers their rewards.
    // as reward tokens are assigned to stakers - the amount as part of each epoch will be updated
    // in this value and this amount has to be assumed 'spent' - only reducing this number as the token
    // is actually sent out by request of the validator itself
    rewardTokenHeldBack: uint64
}
export type PoolInfo = {
    poolAppId: uint64 // The App id of this staking pool contract instance
    totalStakers: uint16
    totalAlgoStaked: uint64
}
type NodeConfig = {
    poolAppIds: StaticArray<uint64, typeof MAX_POOLS_PER_NODE>
}
export type NodePoolAssignmentConfig = {
    nodes: StaticArray<NodeConfig, typeof MAX_NODES>
}
export type PoolTokenPayoutRatio = {
    // MUST TRACK THE MAX_POOLS CONSTANT (MAX_POOLS_PER_NODE * MAX_NODES) !
    poolPctOfWhole: StaticArray<uint64, 24>
    // current round when last set - only pool 1 caller can trigger/calculate this and only once per epoch
    // set and compared against pool 1's lastPayout property.
    updatedForPayout: uint64
}
export type ValidatorInfo = {
    config: ValidatorConfig
    state: ValidatorCurState
    // MUST TRACK THE MAX_POOLS CONSTANT (MAX_POOLS_PER_NODE * MAX_NODES) !
    pools: StaticArray<PoolInfo, 24>
    tokenPayoutRatio: PoolTokenPayoutRatio
    nodePoolAssignments: NodePoolAssignmentConfig
}
export type MbrAmounts = {
    addValidatorMbr: uint64
    addPoolMbr: uint64
    poolInitMbr: uint64
    addStakerMbr: uint64
}
export type Constraints = {
    epochPayoutRoundsMin: uint64
    epochPayoutRoundsMax: uint64
    minPctToValidatorWFourDecimals: uint64
    maxPctToValidatorWFourDecimals: uint64
    minEntryStake: uint64 // in microAlgo
    maxAlgoPerPool: uint64 // in microAlgo
    maxAlgoPerValidator: uint64 // in microAlgo
    amtConsideredSaturated: uint64 // soft stake - when saturation starts - in microAlgo
    maxNodes: uint64
    maxPoolsPerNode: uint64
    maxStakersPerPool: uint64
}
