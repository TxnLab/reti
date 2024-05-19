import {
  convertFromBaseUnits,
  convertToBaseUnits,
  formatAlgoAmount,
  formatAssetAmount,
  formatBigIntWithCommas,
  formatNumber,
  formatWithPrecision,
  roundToFirstNonZeroDecimal,
} from '@/utils/format'

describe('convertFromBaseUnits', () => {
  it('should convert from base units correctly', () => {
    expect(convertFromBaseUnits(1000000, 6)).toBe(1)
    expect(convertFromBaseUnits(1234567, 3)).toBe(1234.567)
  })

  it('should handle zero decimals correctly', () => {
    expect(convertFromBaseUnits(12345, 0)).toBe(12345)
  })
})

describe('convertToBaseUnits', () => {
  it('should convert to base units correctly', () => {
    expect(convertToBaseUnits(1, 6)).toBe(1000000)
    expect(convertToBaseUnits(1234.567, 3)).toBe(1234567)
  })

  it('should handle zero decimals correctly', () => {
    expect(convertToBaseUnits(12345, 0)).toBe(12345)
  })
})

describe('formatWithPrecision', () => {
  it('should format a number with precision and suffixes, trimming zeros', () => {
    expect(formatWithPrecision(1e12, 3)).toBe('1T')
    expect(formatWithPrecision(2.345e12, 1)).toBe('2.3T')
    expect(formatWithPrecision(3.45678e9, 2)).toBe('3.46B')
    expect(formatWithPrecision(4.56789e6, 3)).toBe('4.568M')
    expect(formatWithPrecision(1234.567, 2)).toBe('1.23K')
  })
})

describe('formatAssetAmount', () => {
  it('should format asset amounts correctly', () => {
    expect(formatAssetAmount(1234567, true, 6)).toBe('1.234567')
    expect(formatAssetAmount(1000, false, 0)).toBe('1,000')
  })

  it('should trim trailing zeros when trim is true', () => {
    expect(formatAssetAmount(1000, false, 6, true)).toBe('1,000')
    expect(formatAssetAmount(1234.56789, false, 6, true)).toBe('1,234.56789')
  })

  it('should retain trailing zeros when trim is false', () => {
    expect(formatAssetAmount(1000, false, 6, false)).toBe('1,000.000000')
  })

  it('should handle an invalid amount gracefully', () => {
    expect(formatAssetAmount('abc', true, 6)).toBe('NaN')
  })

  it('should apply the maxLength option', () => {
    expect(formatAssetAmount(1234567890, false, 2, true, 6)).toBe('1.2B')
    expect(formatAssetAmount(1000000, false, 6, true, 5)).toBe('1M')
    expect(formatAssetAmount(987654321, false, 3, true, 8)).toBe('987.7M')
  })
})

describe('formatAlgoAmount', () => {
  it('should format Algorand amounts correctly', () => {
    expect(formatAlgoAmount(1234567, true)).toBe('1.234567')
    expect(formatAlgoAmount(1000000, true)).toBe('1')
  })
})

describe('roundToFirstNonZeroDecimal', () => {
  it('should round to the first non-zero decimal', () => {
    expect(roundToFirstNonZeroDecimal(0.001234)).toBe(0.001)
    expect(roundToFirstNonZeroDecimal(0.0005678)).toBe(0.0006)
    expect(roundToFirstNonZeroDecimal(1234.567)).toBe(1234.567)
  })
})

describe('formatBigIntWithCommas', () => {
  it('should format a BigInt with commas', () => {
    expect(formatBigIntWithCommas(12345678901234567890n)).toBe('12,345,678,901,234,567,890')
  })
})

describe('formatNumber', () => {
  it('should format a large number with commas', () => {
    const result = formatNumber(1234567890)
    expect(result).toBe('1,234,567,890')
  })

  it('should format a number with a specified precision', () => {
    const result = formatNumber(12345.6789, { precision: 2 })
    expect(result).toBe('12,345.68')
  })

  it('should include all decimal places if precision is undefined', () => {
    const result = formatNumber(12345.6789)
    expect(result).toBe('12,345.6789')
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
