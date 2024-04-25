import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import localizedFormat from 'dayjs/plugin/localizedFormat'

dayjs.extend(duration)
dayjs.extend(localizedFormat)

// Utility function to format epoch durations into human-readable strings
export function formatEpochDuration(rounds: number): string {
  // TODO get current average block time from something but hardcode for now
  const avgBlockTime = 2.8
  return `${rounds} blks (~${formatCompactDuration((rounds * avgBlockTime) / 60)})`
}

export function formatCompactDuration(minutes: number): string {
  // Create a duration object from the given minutes
  const durationObj = dayjs.duration(minutes, 'minutes')
  if (minutes < 1) {
    return `${durationObj.asSeconds()}s`
  }

  // Special cases
  if (minutes === 1440) return 'daily'
  if (minutes === 10080) return 'weekly'

  // General case formatting
  const days = durationObj.days()
  const hours = durationObj.hours()
  const mins = durationObj.minutes()
  let result = ''

  if (days > 0) {
    result += `${days}d`
    if (hours > 0 || mins > 0) result += ' '
  }
  if (hours > 0) {
    result += `${hours}h`
    if (mins > 0) result += ' '
  }
  if (mins > 0) {
    result += `${mins}m`
  }

  return result
}

export { dayjs }
