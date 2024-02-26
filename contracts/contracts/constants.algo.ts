// export const MAX_ALGO_PER_POOL = 20_000_000 * 1_000_000; // 20m (micro)Algo
export const MAX_STAKERS_PER_POOL = 100; // *64 (size of StakeInfo) = 6400 bytes
export const MIN_ALGO_STAKE_PER_POOL = 1_000_000; // 1 ALGO
export const MAX_ALGO_PER_POOL = 20_000_000_000_000; // 20m (micro)Algo
export const MIN_PCT_TO_VALIDATOR = 10000; // minimum percentage is 1% (so not a race to bottom?)
export const MAX_PCT_TO_VALIDATOR = 1000000; // 100% w/ four decimals (would be someone's own node for eg)
