import { calculateRewardEligibility } from '@/utils/contracts'

// TODO needs changed for rounds instead of times
describe('calculateRewardEligibility', () => {
  // let currentTime: dayjs.Dayjs

  // beforeEach(() => {
  //   currentTime = dayjs()
  // })

  it('should return null if any of the input parameters are zero', () => {
    expect(calculateRewardEligibility(0, 1625101200, 1625097600)).toBeNull()
    expect(calculateRewardEligibility(30, 0, 1625097600)).toBeNull()
    expect(calculateRewardEligibility(30, 1625101200, 0)).toBeNull()
  })

  it('should return null if any of the input parameters are undefined', () => {
    expect(calculateRewardEligibility(undefined, 1625101200, 1625097600)).toBeNull()
    expect(calculateRewardEligibility(30, undefined, 1625097600)).toBeNull()
    expect(calculateRewardEligibility(30, 1625101200, undefined)).toBeNull()
  })

  // it('should calculate correct percentage when entry time and payout are in the past', () => {
  //   const epochLengthMins = 60
  //   const lastPoolPayoutTime = currentTime.subtract(45, 'minutes').unix() // Last payout 45 minutes ago
  //   const entryTime = currentTime.subtract(15, 'minutes').unix() // Entry time 15 minutes ago
  //   expect(calculateRewardEligibility(epochLengthMins, lastPoolPayoutTime, entryTime)).toBe(50)
  // })
  //
  // it('should calculate correct percentage when entry time was in previous epoch', () => {
  //   const epochLengthMins = 30
  //   const lastPoolPayoutTime = currentTime.subtract(20, 'minutes').unix() // Last payout 20 minutes ago
  //   const entryTime = currentTime.subtract(45, 'minutes').unix() // Entry time 45 minutes ago
  //   expect(calculateRewardEligibility(epochLengthMins, lastPoolPayoutTime, entryTime)).toBe(100)
  // })
  //
  // it('should handle edge case where next payout is exactly now', () => {
  //   const epochLengthMins = 60
  //   const lastPoolPayoutTime = currentTime.subtract(1, 'hour').unix() // Last payout 1 hour ago
  //   const entryTime = currentTime.subtract(1, 'hour').unix() // Entry time 1 hour ago
  //   expect(calculateRewardEligibility(epochLengthMins, lastPoolPayoutTime, entryTime)).toBe(100)
  // })
  //
  // it('should handle postdated entry times correctly', () => {
  //   const epochLengthMins = 1
  //   const lastPoolPayoutTime = currentTime.subtract(1, 'minutes').unix() // Last payout 1 minute ago
  //   const entryTime = currentTime.add(15, 'minutes').unix() // Entry time now (postdated 15 minutes)
  //   expect(calculateRewardEligibility(epochLengthMins, lastPoolPayoutTime, entryTime)).toBe(0)
  // })
  //
  // it('should round down to the nearest integer', () => {
  //   const epochLengthMins = 60 * 4 // 4 hours
  //   const lastPoolPayoutTime = currentTime.subtract(3, 'hours').unix() // Last payout 3 hours ago
  //   // Entry time 1 hour and 1 minute ago, exact eligibility is 50.416666666666664
  //   const entryTime = currentTime.subtract(1, 'hour').subtract(1, 'minute').unix()
  //   expect(calculateRewardEligibility(epochLengthMins, lastPoolPayoutTime, entryTime)).toBe(50)
  // })
  //
  // it('should never return more than 100%', () => {
  //   const epochLengthMins = 60
  //   const lastPoolPayoutTime = currentTime.subtract(3, 'hours').unix() // Last payout 3 hours ago
  //   const entryTime = currentTime.subtract(2, 'hours').unix() // Entry time 2 hours ago
  //   expect(calculateRewardEligibility(epochLengthMins, lastPoolPayoutTime, entryTime)).toBe(100)
  // })
  //
  // it('should never return less than 0%', () => {
  //   const epochLengthMins = 60
  //   const lastPoolPayoutTime = currentTime.unix() // Current time
  //   const entryTime = currentTime.add(1, 'hour').unix() // Entry time in the future
  //   expect(calculateRewardEligibility(epochLengthMins, lastPoolPayoutTime, entryTime)).toBe(0)
  // })
})
