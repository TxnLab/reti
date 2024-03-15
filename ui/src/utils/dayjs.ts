import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import localizedFormat from 'dayjs/plugin/localizedFormat'

dayjs.extend(duration)
dayjs.extend(localizedFormat)

// Utility function to format durations into human-readable strings
export function formatDuration(minutes: number): string {
  // Create a duration object from the given minutes
  const durationObj = dayjs.duration(minutes, 'minutes')

  // Special cases
  if (minutes === 1440) return 'daily'
  if (minutes === 10080) return 'weekly'

  // General case formatting
  const days = durationObj.days()
  const hours = durationObj.hours()
  const mins = durationObj.minutes()
  let result = 'every '

  if (days > 0) {
    result += `${days} day${days > 1 ? 's' : ''}`
    if (hours > 0 || mins > 0) result += ', '
  }
  if (hours > 0) {
    result += `${hours} hour${hours > 1 ? 's' : ''}`
    if (mins > 0) result += ', '
  }
  if (mins > 0) {
    result += `${mins} minute${mins > 1 ? 's' : ''}`
  }

  return result
}

export { dayjs }
