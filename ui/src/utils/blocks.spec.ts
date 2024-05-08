import { calculateAverageBlockTime } from '@/utils/blocks'

describe('calculateAverageBlockTime', () => {
  it('should return the average time between blocks', () => {
    const timestamps = [1683517200, 1683517300, 1683517400, 1683517500] // Sample Unix timestamps (seconds)
    const result = calculateAverageBlockTime(timestamps)

    // The average difference between each block in ms
    expect(result).toBe(100000) // 100 seconds * 1000ms/second
  })

  it('should return 0 if there are fewer than two timestamps', () => {
    const singleTimestamp = [1683517200]
    const result = calculateAverageBlockTime(singleTimestamp)
    expect(result).toBe(0)

    const emptyTimestamps: number[] = []
    const emptyResult = calculateAverageBlockTime(emptyTimestamps)
    expect(emptyResult).toBe(0)
  })

  it('should handle non-consecutive timestamps correctly', () => {
    const timestamps = [1683517200, 1683520800, 1683524400] // Gaps between timestamps
    const result = calculateAverageBlockTime(timestamps)

    // Differences between timestamps (in ms): (3600 + 3600) * 1000 = 7200000 ms
    expect(result).toBe(3600000) // Average is (7200 / 2) * 1000 = 3600000 ms
  })

  it('should handle timestamps provided in descending order', () => {
    const timestamps = [1683517500, 1683517400, 1683517300, 1683517200] // Descending timestamps
    const result = calculateAverageBlockTime(timestamps)

    // The result should still reflect the average difference
    expect(result).toBe(100000) // 100 seconds * 1000ms/second
  })
})
