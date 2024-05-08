import { formatNumber } from '@/utils/format'

describe('formatNumber', () => {
  it('should format a large number with commas', () => {
    const result = formatNumber(1234567890)
    expect(result).toBe('1,234,567,890')
  })

  it('should format a number with a specified precision', () => {
    const result = formatNumber(12345.6789, { precision: 2 })
    expect(result).toBe('12,345.68')
  })

  it('should format a number in compact notation with precision', () => {
    const result = formatNumber(1234567, { compact: true, precision: 2 })
    expect(result).toBe('1.23M')
  })

  it('should format a bigint correctly', () => {
    const result = formatNumber(12345678901234567890n)
    expect(result).toBe('12,345,678,901,234,567,890')
  })

  it('should format a string representation of a number', () => {
    const result = formatNumber('987654321.1234', { precision: 3 })
    expect(result).toBe('987,654,321.123')
  })

  it('should remove trailing zeros if trim is true', () => {
    const result = formatNumber(100.5, { precision: 3, trim: true })
    expect(result).toBe('100.5')
  })

  it('should retain trailing zeros if trim is false', () => {
    const result = formatNumber(100.5, { precision: 3, trim: false })
    expect(result).toBe('100.500')
  })

  it('should handle negative numbers correctly', () => {
    const result = formatNumber(-9876543.21, { precision: 2 })
    expect(result).toBe('-9,876,543.21')
  })
})
