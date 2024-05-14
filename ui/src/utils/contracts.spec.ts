import {
  calculateMaxStake,
  calculateRewardEligibility,
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
        totalStakers: 0,
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
        totalStakers: 400, // Assuming this exceeds the maxStakersPerPool * numPools
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
        sunsettingOn: Math.floor(Date.now() / 1000) - 10, // 10 seconds in the past
      },
    }
    expect(isStakingDisabled(activeAddress, sunsettedValidator, constraints)).toBe(true)
  })

  it('should allow staking under normal conditions', () => {
    const normalValidator = {
      ...MOCK_VALIDATOR_1,
      config: {
        ...MOCK_VALIDATOR_1.config,
        sunsettingOn: 0, // Not sunsetted
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
      validatorId: 1,
      balance: 1000n,
      totalRewarded: 0n,
      rewardTokenBalance: 0n,
      entryTime: 1622548800,
      lastPayout: 1625140800,
      pools: [],
    },
  ]

  const stakesWithoutValidator = [
    {
      validatorId: 2,
      balance: 1000n,
      totalRewarded: 0n,
      rewardTokenBalance: 0n,
      entryTime: 1622548800,
      lastPayout: 1625140800,
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
    expect(calculateRewardEligibility(0, 1000, 500)).toBeNull()
    expect(calculateRewardEligibility(10, 0, 500)).toBeNull()
    expect(calculateRewardEligibility(10, 1000, 0)).toBeNull()
  })

  it('should return null if any input parameter is undefined', () => {
    expect(calculateRewardEligibility(undefined, 1000, 500)).toBeNull()
    expect(calculateRewardEligibility(10, undefined, 500)).toBeNull()
    expect(calculateRewardEligibility(10, 1000, undefined)).toBeNull()
  })

  it('should calculate correct percentage when entry round and payout are in the past', () => {
    const epochRoundLength = 100
    const lastPoolPayoutRound = 900
    const entryRound = 850
    expect(calculateRewardEligibility(epochRoundLength, lastPoolPayoutRound, entryRound)).toBe(50)
  })

  it('should calculate correct percentage when entry round was in the previous epoch', () => {
    const epochRoundLength = 50
    const lastPoolPayoutRound = 200
    const entryRound = 100
    expect(calculateRewardEligibility(epochRoundLength, lastPoolPayoutRound, entryRound)).toBe(100)
  })

  it('should handle edge case where next payout is exactly now', () => {
    const epochRoundLength = 60
    const lastPoolPayoutRound = 120
    const entryRound = 60
    expect(calculateRewardEligibility(epochRoundLength, lastPoolPayoutRound, entryRound)).toBe(100)
  })

  it('should handle postdated entry rounds correctly', () => {
    const epochRoundLength = 1
    const lastPoolPayoutRound = 2
    const entryRound = 20 // Postdated entry round
    expect(calculateRewardEligibility(epochRoundLength, lastPoolPayoutRound, entryRound)).toBe(0)
  })

  it('should round down to the nearest integer', () => {
    const epochRoundLength = 100
    const lastPoolPayoutRound = 300
    const entryRound = 251 // Exact eligibility is 49%
    expect(calculateRewardEligibility(epochRoundLength, lastPoolPayoutRound, entryRound)).toBe(49)
  })

  it('should never return more than 100%', () => {
    const epochRoundLength = 100
    const lastPoolPayoutRound = 300
    const entryRound = 200
    expect(calculateRewardEligibility(epochRoundLength, lastPoolPayoutRound, entryRound)).toBe(100)
  })

  it('should never return less than 0%', () => {
    const epochRoundLength = 100
    const lastPoolPayoutRound = 100
    const entryRound = 200 // Future round beyond the current epoch
    expect(calculateRewardEligibility(epochRoundLength, lastPoolPayoutRound, entryRound)).toBe(0)
  })
})
