import { Asset } from '@/interfaces/algod'
import {
  convertFromBaseUnits,
  convertToBaseUnits,
  formatAlgoAmount,
  formatAssetAmount,
  formatAmount,
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

  it('should handle bigint inputs', () => {
    expect(convertFromBaseUnits(1000000n, 6)).toBe(1)
    expect(convertFromBaseUnits(1234567n, 3)).toBe(1234.567)
  })

  it('should handle string inputs', () => {
    expect(convertFromBaseUnits('1000000', 6)).toBe(1)
    expect(convertFromBaseUnits('1234567', 3)).toBe(1234.567)
  })

  it('should handle bigint decimals', () => {
    expect(convertFromBaseUnits(1000000, 6n)).toBe(1)
    expect(convertFromBaseUnits(1234567, 3n)).toBe(1234.567)
  })

  it('should return NaN for invalid inputs', () => {
    expect(convertFromBaseUnits('invalid', 6)).toBeNaN()
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

  it('should handle bigint inputs', () => {
    expect(convertToBaseUnits(1n, 6)).toBe(1000000)
    expect(convertToBaseUnits(1234n, 3)).toBe(1234000)
  })

  it('should handle string inputs', () => {
    expect(convertToBaseUnits('1', 6)).toBe(1000000)
    expect(convertToBaseUnits('1234.567', 3)).toBe(1234567)
  })

  it('should handle bigint decimals', () => {
    expect(convertToBaseUnits(1, 6n)).toBe(1000000)
    expect(convertToBaseUnits(1234, 3n)).toBe(1234000)
  })

  it('should return NaN for invalid inputs', () => {
    expect(convertToBaseUnits('invalid', 6)).toBeNaN()
  })
})

describe('formatAmount', () => {
  it('should format a large number with commas', () => {
    const result = formatAmount(1234567890)
    expect(result).toBe('1,234,567,890')
  })

  it('should format a number with a specified precision', () => {
    const result = formatAmount(12345.6789, { precision: 2 })
    expect(result).toBe('12,345.68')
  })

  it('should include all decimal places if precision is undefined', () => {
    const result = formatAmount(12345.6789)
    expect(result).toBe('12,345.6789')
  })

  it('should format a number in compact notation with precision', () => {
    const result = formatAmount(1234567, { compact: true, precision: 2 })
    expect(result).toBe('1.23M')
  })

  it('should format Number.MAX_SAFE_INTEGER correctly', () => {
    const result = formatAmount(Number.MAX_SAFE_INTEGER)
    expect(result).toBe('9007.2T')
  })

  it('should format a bigint correctly', () => {
    const result = formatAmount(1234567n)
    expect(result).toBe('1,234,567')

    const compactResult = formatAmount(1234567890123456n)
    expect(compactResult).toBe('1234.6T')

    const expoResult = formatAmount(12345678901234567890n)
    expect(expoResult).toBe('1.23e+19')
  })

  it('should format a string representation of a number', () => {
    const result = formatAmount('987654321.1234', { precision: 3 })
    expect(result).toBe('987,654,321.123')
  })

  it('should remove trailing zeros if trim is true', () => {
    const result = formatAmount(100.5, { precision: 3, trim: true })
    expect(result).toBe('100.5')
  })

  it('should retain trailing zeros if trim is false', () => {
    const result = formatAmount(100.5, { precision: 3, trim: false })
    expect(result).toBe('100.500')
  })

  it('should handle negative numbers correctly', () => {
    const result = formatAmount(-9876543.21, { precision: 2 })
    expect(result).toBe('-9,876,543.21')
  })

  it('should format a number using the decimals option', () => {
    const result = formatAmount(1234567890, { decimals: 2 })
    expect(result).toBe('12,345,678.9')

    const bigIntResult = formatAmount(12345678901234n, { decimals: 6 })
    expect(bigIntResult).toBe('12,345,678.901234')
  })

  it('should format a number with maxLength option', () => {
    const result = formatAmount(1234567890, { maxLength: 5 })
    expect(result).toBe('1.2B')

    const preciseResult = formatAmount(1234567890.12345, { maxLength: 16 })
    expect(preciseResult).toBe('1,234,567,890.12345')

    const compactResult = formatAmount(1234567890.12345, { maxLength: 15 })
    expect(compactResult).toBe('1.2B')
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
  const asset: Asset = {
    params: {
      creator: '',
      decimals: 6,
      name: 'Test Asset',
      total: 1000000,
      'unit-name': 'TEST',
    },
    index: 12345,
  }

  it('should format asset amount correctly with default options', () => {
    const result = formatAssetAmount(asset, 1234567890)
    expect(result).toBe('1,234.56789')
  })

  it('should format asset amount with precision option', () => {
    const result = formatAssetAmount(asset, 1234567890, { precision: 2 })
    expect(result).toBe('1,234.57')
  })

  it('should format asset amount with trim option', () => {
    const result = formatAssetAmount(asset, 1234560000, { precision: 6, trim: true })
    expect(result).toBe('1,234.56')
  })

  it('should format asset amount in compact notation', () => {
    const result = formatAssetAmount(asset, 1234567890, { compact: true, precision: 2 })
    expect(result).toBe('1.23K')
  })

  it('should handle bigint inputs correctly', () => {
    const result = formatAssetAmount(asset, 1234567890n)
    expect(result).toBe('1,234.56789')
  })

  it('should handle string inputs correctly', () => {
    const result = formatAssetAmount(asset, '1234567890')
    expect(result).toBe('1,234.56789')
  })

  it('should handle maximum length option', () => {
    const result = formatAssetAmount(asset, 1234567890, { maxLength: 5 })
    expect(result).toBe('1.2K')
  })

  it('should return NaN for invalid inputs', () => {
    const result = formatAssetAmount(asset, 'invalid')
    expect(result).toBe('NaN')
  })

  it('should include the asset unit name', () => {
    const result = formatAssetAmount(asset, 1234567890, { unitName: true })
    expect(result).toBe('1,234.56789 TEST')
  })
})

describe('formatAlgoAmount', () => {
  it('should format Algo amount correctly with default options', () => {
    const result = formatAlgoAmount(1234567890)
    expect(result).toBe('1,234.56789')
  })

  it('should format Algo amount with precision option', () => {
    const result = formatAlgoAmount(1234567890, { precision: 2 })
    expect(result).toBe('1,234.57')
  })

  it('should format Algo amount with trim option', () => {
    const result = formatAlgoAmount(1234560000, { precision: 6, trim: true })
    expect(result).toBe('1,234.56')

    const noTrimResult = formatAlgoAmount(1234560000, { precision: 6, trim: false })
    expect(noTrimResult).toBe('1,234.560000')
  })

  it('should format Algo amount in compact notation', () => {
    const result = formatAlgoAmount(1234567890, { compact: true, precision: 2 })
    expect(result).toBe('1.23K')
  })

  it('should handle bigint inputs correctly', () => {
    const result = formatAlgoAmount(1234567890n)
    expect(result).toBe('1,234.56789')
  })

  it('should handle string inputs correctly', () => {
    const result = formatAlgoAmount('1234567890')
    expect(result).toBe('1,234.56789')
  })

  it('should handle maximum length option', () => {
    const result = formatAlgoAmount(1234567890, { maxLength: 5 })
    expect(result).toBe('1.2K')
  })

  it('should return NaN for invalid inputs', () => {
    const result = formatAlgoAmount('invalid')
    expect(result).toBe('NaN')
  })
})

describe('roundToFirstNonZeroDecimal', () => {
  it('should round to the first non-zero decimal', () => {
    expect(roundToFirstNonZeroDecimal(0.001234)).toBe(0.001)
    expect(roundToFirstNonZeroDecimal(0.0005678)).toBe(0.0006)
    expect(roundToFirstNonZeroDecimal(1234.567)).toBe(1234.567)
  })
})
