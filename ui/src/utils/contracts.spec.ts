import {
  calculateMaxStake,
  calculateRewardEligibility,
  calculateSaturationPercentage,
  calculateValidatorPoolMetrics,
  getEpochLengthBlocks,
  isStakingDisabled,
  isUnstakingDisabled,
} from '@/utils/contracts'
import { MOCK_CONSTRAINTS, MOCK_VALIDATOR_1, MOCK_VALIDATOR_2 } from './tests/fixtures/validators'
import { ACCOUNT_1 } from './tests/fixtures/accounts'

describe('getEpochLengthBlocks', () => {
  it('should return the input value directly for "blocks" timeframe', () => {
    const inputValue = '100'
    const epochTimeframe = 'blocks'
    const expected = 100
    expect(getEpochLengthBlocks(inputValue, epochTimeframe)).toBe(expected)
  })

  it('should calculate correct number of blocks for "minutes"', () => {
    const inputValue = '1'
    const epochTimeframe = 'minutes'
    const averageBlockTime = 60 * 1000 // 1 minute
    const expected = 1
    expect(getEpochLengthBlocks(inputValue, epochTimeframe, averageBlockTime)).toBe(expected)
  })

  it('should calculate correct number of blocks for "hours"', () => {
    const inputValue = '1'
    const epochTimeframe = 'hours'
    const averageBlockTime = 60 * 1000 // 1 minute
    const expected = 60
    expect(getEpochLengthBlocks(inputValue, epochTimeframe, averageBlockTime)).toBe(expected)
  })

  it('should calculate correct number of blocks for "days"', () => {
    const inputValue = '1'
    const epochTimeframe = 'days'
    const averageBlockTime = 60 * 1000 // 1 minute
    const expected = 1440
    expect(getEpochLengthBlocks(inputValue, epochTimeframe, averageBlockTime)).toBe(expected)
  })

  it('should throw an error for negative average block time when timeframe is not "blocks"', () => {
    const inputValue = '1'
    const epochTimeframe = 'minutes'
    const averageBlockTime = -100 // Negative block time
    expect(() => getEpochLengthBlocks(inputValue, epochTimeframe, averageBlockTime)).toThrow(
      'Average block time must be greater than zero.',
    )
  })

  it('should throw an error for non-numeric value input', () => {
    const inputValue = 'foo'
    const epochTimeframe = 'hours'
    const averageBlockTime = 60 * 1000 // 1 minute
    expect(() => getEpochLengthBlocks(inputValue, epochTimeframe, averageBlockTime)).toThrow(
      'Value must be a number.',
    )
  })

  it('should return 0 for invalid timeframe', () => {
    const inputValue = '10'
    const epochTimeframe = 'foo' // Invalid timeframe
    const averageBlockTime = 60 * 1000 // 1 minute
    const expected = 0
    expect(getEpochLengthBlocks(inputValue, epochTimeframe, averageBlockTime)).toBe(expected)
  })
})

describe('calculateMaxStake', () => {
  it('should return zero if the validator has no pools', () => {
    const constraints = MOCK_CONSTRAINTS
    const validator = {
      ...MOCK_VALIDATOR_1,
      state: {
        ...MOCK_VALIDATOR_1.state,
        numPools: 0,
        totalStakers: 0n,
        totalAlgoStaked: 0n,
      },
    }
    expect(calculateMaxStake(validator, constraints)).toBe(BigInt(0))
  })

  it('should return zero if constraints are not provided', () => {
    const validator = MOCK_VALIDATOR_1
    expect(calculateMaxStake(validator)).toBe(BigInt(0))
  })

  it('should calculate the correct maximum stake with default maxAlgoPerPool config', () => {
    const constraints = MOCK_CONSTRAINTS
    const validator1 = MOCK_VALIDATOR_1 // 1 pool, config.maxAlgoPerPool is 0n
    const validator2 = MOCK_VALIDATOR_2 // 2 pools, config.maxAlgoPerPool is 0n

    const numPools1 = validator1.state.numPools // 2 pools
    const defaultMaxStake1 = Number(constraints.maxAlgoPerPool) * numPools1
    const protocolMaxStake1 = Number(constraints.maxAlgoPerValidator)
    const maxStake1 = Math.min(defaultMaxStake1, protocolMaxStake1)
    expect(calculateMaxStake(validator1, constraints)).toBe(BigInt(maxStake1))

    const numPools2 = validator2.state.numPools // 1 pool
    const defaultMaxStake2 = Number(constraints.maxAlgoPerPool) * numPools2
    const protocolMaxStake2 = Number(constraints.maxAlgoPerValidator)
    const maxStake2 = Math.min(defaultMaxStake2, protocolMaxStake2)
    expect(calculateMaxStake(validator2, constraints)).toBe(BigInt(maxStake2))
  })

  it('should calculate the correct maximum stake when custom maxAlgoPerPool is configured', () => {
    const constraints = MOCK_CONSTRAINTS
    const validator = {
      ...MOCK_VALIDATOR_1,
      config: {
        ...MOCK_VALIDATOR_1.config,
        maxAlgoPerPool: 10000000000000n, // 10M ALGO custom maxAlgoPerPool
      },
    }

    const numPools = validator.state.numPools
    const configuredMaxStake = Number(validator.config.maxAlgoPerPool) * numPools
    const protocolMaxStake = Number(constraints.maxAlgoPerValidator)
    const maxStake = Math.min(configuredMaxStake, protocolMaxStake)
    expect(calculateMaxStake(validator, constraints)).toBe(BigInt(maxStake))
  })

  it('should respect the protocol maximum when less than the calculated maximum', () => {
    const constraints = {
      ...MOCK_CONSTRAINTS,
      maxAlgoPerValidator: BigInt(500000000000n), // 50M ALGO protocol max, lower than the default
    }
    const validator = MOCK_VALIDATOR_1

    const numPools = validator.state.numPools
    const defaultMaxStake = Number(constraints.maxAlgoPerPool) * numPools
    const protocolMaxStake = Number(constraints.maxAlgoPerValidator)
    const maxStake = Math.min(defaultMaxStake, protocolMaxStake)
    expect(calculateMaxStake(validator, constraints)).toBe(BigInt(maxStake))
  })
})

describe('isStakingDisabled', () => {
  const activeAddress = ACCOUNT_1
  const constraints = MOCK_CONSTRAINTS

  it('should disable staking if no active address is provided', () => {
    expect(isStakingDisabled(null, MOCK_VALIDATOR_1, constraints)).toBe(true)
  })

  it('should disable staking if the maximum number of stakers has been reached', () => {
    const validator = {
      ...MOCK_VALIDATOR_1,
      state: {
        ...MOCK_VALIDATOR_1.state,
        totalStakers: 400n, // Assuming this exceeds the maxStakersPerPool * numPools
      },
    }
    expect(isStakingDisabled(activeAddress, validator, constraints)).toBe(true)
  })

  it('should disable staking if the maximum stake has been reached', () => {
    const validator = {
      ...MOCK_VALIDATOR_1,
      state: {
        ...MOCK_VALIDATOR_1.state,
        totalAlgoStaked: BigInt(constraints.maxAlgoPerValidator + 1000n), // Exceeds maxStake
      },
    }
    expect(isStakingDisabled(activeAddress, validator, constraints)).toBe(true)
  })

  it('should disable staking if no pools are available', () => {
    const validator = {
      ...MOCK_VALIDATOR_1,
      state: {
        ...MOCK_VALIDATOR_1.state,
        numPools: 0,
      },
    }
    expect(isStakingDisabled(activeAddress, validator, constraints)).toBe(true)
  })

  it('should disable staking if the validator is sunsetted', () => {
    const sunsettedValidator = {
      ...MOCK_VALIDATOR_1,
      config: {
        ...MOCK_VALIDATOR_1.config,
        sunsettingOn: BigInt(Math.floor(Date.now() / 1000) - 10), // 10 seconds in the past
      },
    }
    expect(isStakingDisabled(activeAddress, sunsettedValidator, constraints)).toBe(true)
  })

  it('should allow staking under normal conditions', () => {
    const normalValidator = {
      ...MOCK_VALIDATOR_1,
      config: {
        ...MOCK_VALIDATOR_1.config,
        sunsettingOn: 0n, // Not sunsetted
      },
    }
    expect(isStakingDisabled(activeAddress, normalValidator, constraints)).toBe(false)
  })
})

describe('isUnstakingDisabled', () => {
  const activeAddress = 'SOME_ACTIVE_ADDRESS'

  const validator = MOCK_VALIDATOR_1

  const stakesWithValidator = [
    {
      validatorId: 1n,
      balance: 1000n,
      totalRewarded: 0n,
      rewardTokenBalance: 0n,
      entryRound: 1622548800n,
      lastPayout: 1625140800n,
      pools: [],
    },
  ]

  const stakesWithoutValidator = [
    {
      validatorId: 2n,
      balance: 1000n,
      totalRewarded: 0n,
      rewardTokenBalance: 0n,
      entryRound: 1622548800n,
      lastPayout: 1625140800n,
      pools: [],
    },
  ]

  it('should disable unstaking if no active address is provided', () => {
    expect(isUnstakingDisabled(null, validator, stakesWithValidator)).toBe(true)
  })

  it('should disable unstaking if the validator has no pools', () => {
    const validatorNoPools = { ...validator, state: { ...validator.state, numPools: 0 } }
    expect(isUnstakingDisabled(activeAddress, validatorNoPools, stakesWithValidator)).toBe(true)
  })

  it('should disable unstaking if the validator has no associated stakes', () => {
    expect(isUnstakingDisabled(activeAddress, validator, stakesWithoutValidator)).toBe(true)
  })

  it('should allow unstaking under normal conditions', () => {
    expect(isUnstakingDisabled(activeAddress, validator, stakesWithValidator)).toBe(false)
  })
})

describe('calculateRewardEligibility', () => {
  it('should return null if any input parameter is zero', () => {
    expect(calculateRewardEligibility(0, 1000n, 500n)).toBeNull()
    expect(calculateRewardEligibility(10, 0n, 500n)).toBeNull()
    expect(calculateRewardEligibility(10, 1000n, 0n)).toBeNull()
  })

  it('should return null if any input parameter is undefined', () => {
    expect(calculateRewardEligibility(undefined, 1000n, 500n)).toBeNull()
    expect(calculateRewardEligibility(10, undefined, 500n)).toBeNull()
    expect(calculateRewardEligibility(10, 1000n, undefined)).toBeNull()
  })

  it('should calculate correct percentage when entry round is halfway through an epoch', () => {
    const epochRoundLength = 100
    const lastPoolPayoutRound = 900n
    const entryRound = 950n
    expect(calculateRewardEligibility(epochRoundLength, lastPoolPayoutRound, entryRound)).toBe(50)
  })

  it('should calculate correct percentage when entry round was in the previous epoch', () => {
    const epochRoundLength = 50
    const lastPoolPayoutRound = 200n
    const entryRound = 100n
    expect(calculateRewardEligibility(epochRoundLength, lastPoolPayoutRound, entryRound)).toBe(100)
  })

  it('should handle edge case where next payout is exactly now', () => {
    const epochRoundLength = 60
    const lastPoolPayoutRound = 120n
    const entryRound = 60n
    expect(calculateRewardEligibility(epochRoundLength, lastPoolPayoutRound, entryRound)).toBe(100)
  })

  it('should handle postdated entry rounds correctly', () => {
    const epochRoundLength = 1
    const lastPoolPayoutRound = 2n
    const entryRound = 20n // Postdated entry round
    expect(calculateRewardEligibility(epochRoundLength, lastPoolPayoutRound, entryRound)).toBe(0)
  })

  it('should round down to the nearest integer', () => {
    const epochRoundLength = 200
    const lastPoolPayoutRound = 600n
    const entryRound = 651n // Exact eligibility is 74.5%
    expect(calculateRewardEligibility(epochRoundLength, lastPoolPayoutRound, entryRound)).toBe(74)
  })

  it('should never return more than 100%', () => {
    const epochRoundLength = 100
    const lastPoolPayoutRound = 300n
    const entryRound = 200n // Calculated eligibility is 200%
    expect(calculateRewardEligibility(epochRoundLength, lastPoolPayoutRound, entryRound)).toBe(100)
  })

  it('should never return less than 0%', () => {
    const epochRoundLength = 100
    const lastPoolPayoutRound = 100n
    const entryRound = 250n // Future round beyond the current epoch
    expect(calculateRewardEligibility(epochRoundLength, lastPoolPayoutRound, entryRound)).toBe(0)
  })
})

describe('calculateSaturationPercentage', () => {
  it('should return 0% if the validator has no stake', () => {
    const validator = {
      ...MOCK_VALIDATOR_1,
      state: {
        ...MOCK_VALIDATOR_1.state,
        totalAlgoStaked: 0n,
      },
    }
    expect(calculateSaturationPercentage(validator, MOCK_CONSTRAINTS)).toBe(0)
  })

  it('should calculate the correct saturation percentage', () => {
    const validator = {
      ...MOCK_VALIDATOR_1,
      state: {
        ...MOCK_VALIDATOR_1.state,
        totalAlgoStaked: 72000000000000n,
      },
    }

    // 300000000000000n is the protocol maximum in MOCK_CONSTRAINTS
    const result = calculateSaturationPercentage(validator, MOCK_CONSTRAINTS)
    expect(result).toBe(24)
  })

  it('should round to the nearest whole number', () => {
    const validator = {
      ...MOCK_VALIDATOR_1,
      state: {
        ...MOCK_VALIDATOR_1.state,
        totalAlgoStaked: 71184768795601n,
      },
    }

    const result = calculateSaturationPercentage(validator, MOCK_CONSTRAINTS)
    expect(result).toBe(24) // 23.72825626 rounded to 24
  })

  it('should return 100% if the total stake exceeds the protocol maximum', () => {
    const validator = {
      ...MOCK_VALIDATOR_1,
      state: {
        ...MOCK_VALIDATOR_1.state,
        totalAlgoStaked: MOCK_CONSTRAINTS.maxAlgoPerValidator + 1000n,
      },
    }
    expect(calculateSaturationPercentage(validator, MOCK_CONSTRAINTS)).toBe(100)
  })

  it('should handle very small percentages correctly', () => {
    const validator = {
      ...MOCK_VALIDATOR_1,
      state: {
        ...MOCK_VALIDATOR_1.state,
        totalAlgoStaked: 50000000n,
      },
    }

    const result = calculateSaturationPercentage(validator, MOCK_CONSTRAINTS)
    expect(result).toBe(0.0001)
  })

  it('should handle extremely small percentages by returning 0.0001', () => {
    const validator = {
      ...MOCK_VALIDATOR_1,
      state: {
        ...MOCK_VALIDATOR_1.state,
        totalAlgoStaked: 1n,
      },
    }
    const constraints = {
      ...MOCK_CONSTRAINTS,
      maxAlgoPerValidator: 1000000000000n,
    }

    const result = calculateSaturationPercentage(validator, constraints)
    expect(result).toBe(0.0001)
  })

  it('should round to first non-zero decimal for small percentages', () => {
    const validator = {
      ...MOCK_VALIDATOR_1,
      state: {
        ...MOCK_VALIDATOR_1.state,
        totalAlgoStaked: 5000000000n,
      },
    }

    const result = calculateSaturationPercentage(validator, MOCK_CONSTRAINTS)
    expect(result).toBe(0.002) // 0.00166666 rounded to 0.002
  })

  it('should return 0 when constraints is null or undefined', () => {
    // @ts-expect-error constraints is null
    expect(calculateSaturationPercentage(MOCK_VALIDATOR_1, null)).toBe(0)
    // @ts-expect-error constraints is undefined
    expect(calculateSaturationPercentage(MOCK_VALIDATOR_1, undefined)).toBe(0)
  })

  it('should return 0 when maxAlgoPerValidator is 0', () => {
    const constraints = {
      ...MOCK_CONSTRAINTS,
      maxAlgoPerValidator: 0n,
    }
    expect(calculateSaturationPercentage(MOCK_VALIDATOR_1, constraints)).toBe(0)
  })

  it('should calculate correctly for percentages just below 100%', () => {
    const validator = {
      ...MOCK_VALIDATOR_1,
      state: {
        ...MOCK_VALIDATOR_1.state,
        totalAlgoStaked: 99999999999999n,
      },
    }
    const constraints = {
      ...MOCK_CONSTRAINTS,
      maxAlgoPerValidator: 100000000000000n,
    }
    expect(calculateSaturationPercentage(validator, constraints)).toBe(99)
  })

  it('should round correctly at the 0.00005 threshold', () => {
    const validator = {
      ...MOCK_VALIDATOR_1,
      state: {
        ...MOCK_VALIDATOR_1.state,
        totalAlgoStaked: 150000n,
      },
    }
    const constraints = {
      ...MOCK_CONSTRAINTS,
      maxAlgoPerValidator: 300000000000000n,
    }
    expect(calculateSaturationPercentage(validator, constraints)).toBe(0.0001)
  })

  it('should round correctly just above the 0.00005 threshold', () => {
    const validator = {
      ...MOCK_VALIDATOR_1,
      state: {
        ...MOCK_VALIDATOR_1.state,
        totalAlgoStaked: 151000n,
      },
    }
    const constraints = {
      ...MOCK_CONSTRAINTS,
      maxAlgoPerValidator: 300000000000000n,
    }
    expect(calculateSaturationPercentage(validator, constraints)).toBe(0.0001)
  })
})

describe('calculateValidatorPoolMetrics', () => {
  const epochRoundLength = 1000n
  const currentRound = 5000n

  it('calculates metrics correctly with multiple non-zero balance pools', () => {
    const poolsData = [
      { balance: 1000000n, lastPayout: 4000n, apy: 5 },
      { balance: 2000000n, lastPayout: 3500n, apy: 7 },
      { balance: 3000000n, lastPayout: 4500n, apy: 6 },
    ]
    const totalAlgoStaked = 5500000n

    const result = calculateValidatorPoolMetrics(
      poolsData,
      totalAlgoStaked,
      epochRoundLength,
      currentRound,
    )

    expect(result.rewardsBalance).toBe(1000000n) // Rounded to nearest whole ALGO
    expect(result.roundsSinceLastPayout).toBe(1000n)
    expect(result.apy).toBe(6)
  })

  it('handles pools with zero balance', () => {
    const poolsData = [
      { balance: 1000000n, lastPayout: 4000n, apy: 5 },
      { balance: 0n, lastPayout: 3500n, apy: 0 },
      { balance: 3000000n, lastPayout: 4500n, apy: 6 },
    ]
    const totalAlgoStaked = 3900000n

    const result = calculateValidatorPoolMetrics(
      poolsData,
      totalAlgoStaked,
      epochRoundLength,
      currentRound,
    )

    expect(result.rewardsBalance).toBe(0n)
    expect(result.roundsSinceLastPayout).toBe(1000n)
    expect(result.apy).toBe(5.5)
  })

  it('returns zero APY when all pools have zero balance', () => {
    const poolsData = [
      { balance: 0n, lastPayout: 4000n, apy: 0 },
      { balance: 0n, lastPayout: 3500n, apy: 0 },
    ]
    const totalAlgoStaked = 0n

    const result = calculateValidatorPoolMetrics(
      poolsData,
      totalAlgoStaked,
      epochRoundLength,
      currentRound,
    )

    expect(result.rewardsBalance).toBe(0n)
    expect(result.roundsSinceLastPayout).toBe(1000n)
    expect(result.apy).toBe(0)
  })

  it('handles undefined lastPayout', () => {
    const poolsData = [
      { balance: 1000000n, lastPayout: undefined, apy: 5 },
      { balance: 2000000n, lastPayout: 3500n, apy: 7 },
    ]
    const totalAlgoStaked = 2900000n

    const result = calculateValidatorPoolMetrics(
      poolsData,
      totalAlgoStaked,
      epochRoundLength,
      currentRound,
    )

    expect(result.rewardsBalance).toBe(0n)
    expect(result.roundsSinceLastPayout).toBe(1000n)
    expect(result.apy).toBe(6)
  })

  it('returns undefined roundsSinceLastPayout when no valid lastPayout', () => {
    const poolsData = [
      { balance: 1000000n, lastPayout: undefined, apy: 5 },
      { balance: 2000000n, lastPayout: undefined, apy: 7 },
    ]
    const totalAlgoStaked = 2900000n

    const result = calculateValidatorPoolMetrics(
      poolsData,
      totalAlgoStaked,
      epochRoundLength,
      currentRound,
    )

    expect(result.rewardsBalance).toBe(0n)
    expect(result.roundsSinceLastPayout).toBeUndefined()
    expect(result.apy).toBe(6)
  })

  it('handles negative rewards balance', () => {
    const poolsData = [
      { balance: 1000000n, lastPayout: 4000n, apy: 5 },
      { balance: 2000000n, lastPayout: 3500n, apy: 7 },
    ]
    const totalAlgoStaked = 3100000n

    const result = calculateValidatorPoolMetrics(
      poolsData,
      totalAlgoStaked,
      epochRoundLength,
      currentRound,
    )

    expect(result.rewardsBalance).toBe(0n)
    expect(result.roundsSinceLastPayout).toBe(1000n)
    expect(result.apy).toBe(6)
  })
})
