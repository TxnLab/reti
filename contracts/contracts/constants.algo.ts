

export const MAX_STAKERS_PER_POOL = 100; // *64 (size of StakeInfo) = 6400 bytes
export const MIN_ALGO_STAKE_PER_POOL = 1_000_000; // 1 ALGO
export const MAX_ALGO_PER_POOL = 50_000_000_000_000; // 50m (micro)Algo
export const MIN_PCT_TO_VALIDATOR = 0; // minimum percentage is 0 - let the market decide
export const MAX_PCT_TO_VALIDATOR = 1000000; // 100% w/ four decimals (would be someone's own node for eg)

export const ALGORAND_ACCOUNT_MIN_BALANCE = 100000;
// values taken from: https://developer.algorand.org/docs/features/asc1/stateful/#minimum-balance-requirement-for-a-smart-contract
export const APPLICATION_BASE_FEE = 100000; // base fee for creating or opt-in to application
export const ASSET_HOLDING_FEE = 100000; // creation fee for asset
export const SSC_VALUE_UINT = 28500; // cost for value as uint64
export const SSC_VALUE_BYTES = 50000; // cost for value as bytes
