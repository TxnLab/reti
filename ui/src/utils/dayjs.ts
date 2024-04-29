import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import localizedFormat from 'dayjs/plugin/localizedFormat'

dayjs.extend(duration)
dayjs.extend(localizedFormat)

export function formatDuration(milliseconds: number): string {
  const dur = dayjs.duration(milliseconds)

  const days = dur.days()
  const hours = dur.hours()
  const minutes = dur.minutes()

  let result = ''

  if (days > 0) result += `${days}d `
  if (hours > 0) result += `${hours}h `
  if (minutes > 0) result += `${minutes}m `

  return result.trim()
}

export { dayjs }
