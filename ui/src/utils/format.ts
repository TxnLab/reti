import Big from 'big.js'

/**
 * Convert an asset amount from base units to whole units
 * @param {number} amount - The amount in base units
 * @param {number} decimals - The number of decimal places
 * @returns {number} The amount in whole units
 * @example
 * convertFromBaseUnits(12345, 0) // 12345
 * convertFromBaseUnits(12345, 6) // 0.012345
 * convertFromBaseUnits(1000000, 6) // 1
 */
export function convertFromBaseUnits(amount: number, decimals: number = 0): number {
  if (decimals === 0) return amount
  const divisor = new Big(10).pow(decimals)
  return new Big(amount).div(divisor).toNumber()
}

/**
 * Convert an asset amount from whole units to base units
 * @param {number} amount - The amount in whole units
 * @param {number} decimals - The number of decimal places
 * @returns {number} The amount in base units
 * @example
 * convertToBaseUnits(1, 6) // 1000000
 * convertToBaseUnits(0.012345, 6) // 12345
 * convertToBaseUnits(12345, 0) // 12345
 */
export function convertToBaseUnits(amount: number, decimals: number = 0): number {
  if (decimals === 0) return amount
  const multiplier = new Big(10).pow(decimals)
  return new Big(amount).times(multiplier).toNumber()
}

/**
 * Format a number with precision and suffixes
 * @param {number} num - The number to format
 * @param {number} precision - The number of decimal places
 * @returns {string} The formatted number with precision and suffixes
 * @example
 * formatWithPrecision(1e12, 3) // '1T'
 * formatWithPrecision(2.345e12, 1) // '2.3T'
 * formatWithPrecision(3.45678e9, 2) // '3.46B'
 * formatWithPrecision(4.56789e6, 3) // '4.568M'
 * formatWithPrecision(1234.567, 2) // '1.23K'
 */
export function formatWithPrecision(num: number, precision: number): string {
  let scaledNum = num
  let suffix = ''

  // Determine the appropriate suffix and scale the number
  if (num >= 1e12) {
    suffix = 'T'
    scaledNum = num / 1e12
  } else if (num >= 1e9) {
    suffix = 'B'
    scaledNum = num / 1e9
  } else if (num >= 1e6) {
    suffix = 'M'
    scaledNum = num / 1e6
  } else if (num >= 1e3) {
    suffix = 'K'
    scaledNum = num / 1e3
  }

  // Format the number with precision and trim trailing zeros
  const formattedNumber = scaledNum.toFixed(precision).replace(/\.?0+$/, '')

  return formattedNumber + suffix
}

// @todo: Convert options to an object
/**
 * Format an asset amount with commas and optional decimal places
 * @param {number | string} amount - The asset amount to format
 * @param {boolean} baseUnits - Whether the amount is in base units
 * @param {number} decimals - The number of decimal places
 * @param {boolean} trim - Whether to trim trailing zeros
 * @param {number} maxLength - The maximum length of the formatted string
 * @returns {string} The formatted asset amount
 * @example
 * formatAssetAmount(1234567, true, 6) // '1.234567'
 * formatAssetAmount(1000, false, 0) // '1,000'
 * formatAssetAmount(1234.56789, false, 6, true) // '1,234.56789'
 * formatAssetAmount(1000, false, 6, false) // '1,000.000000'
 * formatAssetAmount('abc', true, 6) // 'NaN'
 * formatAssetAmount(1234.56789, false, 6, true, 10) // '1.2K'
 */
export function formatAssetAmount(
  amount: number | string,
  baseUnits: boolean = false,
  decimals: number = 6,
  trim: boolean = true,
  maxLength?: number,
): string {
  // If amount is a string, parse it to a number
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
  if (isNaN(numAmount)) return 'NaN'

  // Convert to string
  // If amount is in base units, convert from base units
  const formatted = baseUnits
    ? convertFromBaseUnits(numAmount, decimals).toFixed(decimals)
    : new Big(numAmount).toFixed(decimals)

  const parts = formatted.split('.')

  if (trim && parts.length === 2) {
    parts[1] = parts[1].replace(/\.?0+$/, '')
  }

  if (maxLength && parts.join('.').length > maxLength) {
    return formatWithPrecision(parseFloat(formatted), 1)
  }

  // Format number with commas, but don't affect decimal places
  parts[0] = new Intl.NumberFormat().format(parseFloat(parts[0]))

  if (parts[1] === '') {
    return parts[0]
  }

  return parts.join('.')
}

// @todo: Convert options to an object
/**
 * Format an Algo amount with commas and optional decimal places
 * @param {number | string} amount - The Algo amount to format
 * @param {boolean} microalgos - Whether the amount is in microalgos
 * @param {boolean} trim - Whether to trim trailing zeros
 * @param {number} maxLength - The maximum length of the formatted string
 * @returns {string} The formatted Algo amount
 * @example
 * formatAlgoAmount(1234567, true) // '1.234567'
 * formatAlgoAmount(1000, false) // '1,000'
 * formatAlgoAmount(1234.56789, false, true) // '1,234.56789'
 * formatAlgoAmount(1000, false, false) // '1,000.000000'
 */
export function formatAlgoAmount(
  amount: number | string,
  microalgos: boolean = false,
  trim: boolean = true,
  maxLength?: number,
): string {
  return formatAssetAmount(amount, microalgos, 6, trim, maxLength)
}

/**
 * Round a number to the first non-zero decimal place
 * @param {number} num - The number to round
 * @returns {number} The rounded number
 * @example
 * roundToFirstNonZeroDecimal(0.001234) // 0.001
 * roundToFirstNonZeroDecimal(0.0005678) // 0.0006
 * roundToFirstNonZeroDecimal(1234.567) // 1234.567
 */
export function roundToFirstNonZeroDecimal(num: number): number {
  if (num === 0) return 0

  // Convert the number to exponential format to find the exponent
  const expForm = num.toExponential().split('e')
  const exponent = parseInt(expForm[1])

  // Calculate the number of decimal places needed
  const decimalPlaces = Math.abs(exponent)

  // Use toFixed to round to the first significant decimal place
  return Number(num.toFixed(decimalPlaces))
}

/**
 * Format a BigInt with commas
 * @param {bigint} value - The BigInt value
 * @returns {string} The formatted BigInt value with commas
 * @example
 * formatBigIntWithCommas(12345678901234567890n) // '12,345,678,901,234,567,890'
 */
export function formatBigIntWithCommas(value: bigint): string {
  const valueStr = value.toString()
  const regex = /\B(?=(\d{3})+(?!\d))/g
  return valueStr.replace(regex, ',')
}

type FormatNumberOptions = {
  compact?: boolean
  precision?: number
  trim?: boolean
}

/**
 * Format a number with commas and optional decimal places
 * @param {number | bigint | string} amount - The number to format
 * @param {FormatNumberOptions} options - Options for formatting the number
 * @param {boolean} options.compact - Whether to format the number in compact notation
 * @param {number} options.precision - The number of decimal places
 * @param {boolean} options.trim - Whether to trim trailing zeros
 * @returns {string} The formatted number
 * @example
 * formatNumber(1234567890) // '1,234,567,890'
 * formatNumber(12345.6789, { precision: 2 }) // '12,345.68'
 * formatNumber(1234567, { compact: true, precision: 2 }) // '1.23M'
 * formatNumber(12345678901234567890n) // '12,345,678,901,234,567,890'
 * formatNumber('987654321.1234', { precision: 3 }) // '987,654,321.123'
 * formatNumber(100.5, { precision: 3, trim: true }) // '100.5'
 * formatNumber(100.5, { precision: 3, trim: false }) // '100.500'
 * formatNumber(-9876543.21, { precision: 2 }) // '-9,876,543.21'
 */
export function formatNumber(
  amount: number | bigint | string,
  options: FormatNumberOptions = {},
): string {
  const { compact = false, precision, trim = true } = options

  // Handle BigInt separately to preserve precision
  if (typeof amount === 'bigint') {
    const formattedBigInt = formatBigIntWithCommas(amount)
    return formattedBigInt
  }

  const numericAmount = parseFloat(String(amount))

  if (compact) {
    return formatWithPrecision(numericAmount, precision || 0)
  }

  const bigAmount = new Big(numericAmount).toFixed(precision)
  const parts = bigAmount.split('.')

  // Add commas to the integer part
  parts[0] = new Intl.NumberFormat().format(parseInt(parts[0], 10))

  // Handle decimal trimming
  if (trim && parts.length === 2) {
    parts[1] = parts[1].replace(/\.?0+$/, '') // Trim trailing zeros
  }

  return parts.length === 1 ? parts[0] : parts.join('.')
}
