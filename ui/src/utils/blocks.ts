import { dayjs } from '@/utils/dayjs'

/**
 * Calculate the average time between Algorand blocks.
 * @param {number[]} timestamps - Block times, UNIX timestamps (in seconds)
 * @returns {number} Average time between blocks (in ms)
 */
export function calculateAverageBlockTime(timestamps: number[]): number {
  if (timestamps.length < 2) {
    return 0
  }

  const blockTimes: dayjs.Dayjs[] = timestamps.map((ts) => dayjs.unix(ts))

  let totalBlockTime = 0
  for (let i = 1; i < blockTimes.length; i++) {
    const duration = Math.abs(blockTimes[i].diff(blockTimes[i - 1])) // Calculate ms between blocks
    totalBlockTime += duration // Sum the durations
  }

  const averageBlockTime = totalBlockTime / (blockTimes.length - 1) // Calculate average
  return averageBlockTime
}
