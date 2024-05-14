import { formatDuration } from '@/utils/dayjs'

describe('formatDuration', () => {
  it('should format a duration of less than a minute correctly', () => {
    const milliseconds = 45000 // 45 seconds
    const result = formatDuration(milliseconds)
    expect(result).toBe('45s')
  })

  it('should format a duration of more than a minute but less than an hour correctly', () => {
    const milliseconds = 600000 // 10 minutes
    const result = formatDuration(milliseconds)
    expect(result).toBe('10m')
  })

  it('should format a duration of more than an hour but less than a day correctly', () => {
    const milliseconds = 5400000 // 1 hour 30 minutes
    const result = formatDuration(milliseconds)
    expect(result).toBe('1h 30m')
  })

  it('should format a duration of multiple days correctly', () => {
    const milliseconds = 181800000 // 2 days 2 hours 30 minutes
    const result = formatDuration(milliseconds)
    expect(result).toBe('2d 2h 30m')
  })

  it('should format a duration with all units correctly', () => {
    const milliseconds = 123456789 // 1 day 10 hours 17 minutes 36 seconds
    const result = formatDuration(milliseconds)
    expect(result).toBe('1d 10h 17m 36s')
  })

  it('should handle a zero duration correctly', () => {
    const result = formatDuration(0)
    expect(result).toBe('')
  })

  it('should not include zero-valued components in the output', () => {
    const milliseconds = 3600000 // 1 hour
    const result = formatDuration(milliseconds)
    expect(result).toBe('1h')
  })
})
