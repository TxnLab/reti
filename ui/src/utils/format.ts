import Big from 'big.js'
import { Asset } from '@/interfaces/algod'

/**
 * Convert an asset amount from base units to whole units
 * @param {number | bigint | string} amount - The amount in base units
 * @param {number | bigint} decimals - The number of decimal places
 * @returns {number} The amount in whole units
 * @example
 * convertFromBaseUnits(12345, 0) // 12345
 * convertFromBaseUnits(12345, 6) // 0.012345
 * convertFromBaseUnits(1000000, 6) // 1
 */
export function convertFromBaseUnits(
  amount: number | bigint | string,
  decimals: number | bigint = 0,
): number {
  try {
    const divisor = decimals ? new Big(10).pow(Number(decimals)) : new Big(1)
    const bigAmount = typeof amount === 'bigint' ? new Big(amount.toString()) : new Big(amount)
    return bigAmount.div(divisor).toNumber()
  } catch {
    return NaN
  }
}

/**
 * Convert an asset amount from whole units to base units
 * @param {number | bigint | string} amount - The amount in whole units
 * @param {number | bigint} decimals - The number of decimal places
 * @returns {number} The amount in base units
 * @example
 * convertToBaseUnits(1, 6) // 1000000
 * convertToBaseUnits(0.012345, 6) // 12345
 * convertToBaseUnits(12345, 0) // 12345
 */
export function convertToBaseUnits(
  amount: number | bigint | string,
  decimals: number | bigint = 0,
): number {
  try {
    const multiplier = decimals ? new Big(10).pow(Number(decimals)) : new Big(1)
    const bigAmount = typeof amount === 'bigint' ? new Big(amount.toString()) : new Big(amount)
    return bigAmount.times(multiplier).toNumber()
  } catch {
    return NaN
  }
}

type FormatAmountOptions = {
  compact?: boolean
  precision?: number
  trim?: boolean
  maxLength?: number
  decimals?: number
}

/**
 * Format an amount with options for base unit conversion, precision, compact notation, and trimming
 * @param {number | bigint | string} amount - The number to format
 * @param {FormatAmountOptions} options - Options for formatting the number
 * @param {boolean} options.compact - Whether to format the number in compact notation
 * @param {number} options.precision - The number of decimal places
 * @param {boolean} options.trim - Whether to trim trailing zeros
 * @param {number} options.maxLength - The maximum length of the formatted number
 * @param {number} options.decimals - The number of decimal places for base unit conversion
 * @returns {string} The formatted number
 * @example
 * formatAmount(1234567890) // '1,234,567,890'
 * formatAmount(12345.6789, { precision: 2 }) // '12,345.68'
 * formatAmount(1234567, { compact: true, precision: 2 }) // '1.23M'
 * formatAmount('987654321.1234', { precision: 3 }) // '987,654,321.123'
 * formatAmount(100.5, { precision: 3, trim: true }) // '100.5'
 * formatAmount(100.5, { precision: 3, trim: false }) // '100.500'
 * formatAmount(123456789, { decimals: 2 }) // '1,234,567.89'
 */
export function formatAmount(
  amount: number | bigint | string,
  options: FormatAmountOptions = {},
): string {
  const { compact = false, precision, trim = true, maxLength = 15, decimals } = options

  const divisor = decimals ? new Big(10).pow(decimals) : new Big(1)

  let fixedAmount: string

  try {
    const bigAmount =
      typeof amount === 'bigint'
        ? new Big(amount.toString()).div(divisor)
        : new Big(amount).div(divisor)

    if (bigAmount.gt(Number.MAX_SAFE_INTEGER)) {
      return bigAmount.toExponential(2)
    }

    if (compact) {
      return formatWithPrecision(bigAmount.toNumber(), precision || 0)
    }

    if (bigAmount.round().toString().length > Math.min(maxLength, 15)) {
      return formatWithPrecision(bigAmount.toNumber(), precision || 1)
    }

    fixedAmount = bigAmount.toFixed(precision)
  } catch {
    return 'NaN'
  }

  if (maxLength && fixedAmount.length > maxLength) {
    return formatWithPrecision(fixedAmount, 1)
  }

  // Split the number into integer and decimal parts
  let [integerPart, decimalPart] = fixedAmount.split('.')

  // Add commas to the integer part
  integerPart = new Intl.NumberFormat().format(parseInt(integerPart, 10))

  // Handle decimal trimming
  if (trim && decimalPart) {
    decimalPart = decimalPart.replace(/\.?0+$/, '') // Trim trailing zeros
  }

  const formatted = !decimalPart ? integerPart : [integerPart, decimalPart].join('.')

  return formatted
}

/**
 * Format a number with precision and suffixes
 * @param {number | string} num - The number to format (can be a number or a string)
 * @param {number} precision - The number of decimal places
 * @returns {string} The formatted number with precision and suffixes
 * @example
 * formatWithPrecision(1e12, 3) // '1T'
 * formatWithPrecision(2.345e12, 1) // '2.3T'
 * formatWithPrecision(3.45678e9, 2) // '3.46B'
 * formatWithPrecision(4.56789e6, 3) // '4.568M'
 * formatWithPrecision(1234.567, 2) // '1.23K'
 */
export function formatWithPrecision(num: number | string, precision: number): string {
  const bigNum = new Big(num)
  let scaledNum = bigNum
  let suffix = ''

  // Determine the appropriate suffix and scale the number
  if (bigNum.gte(1e12)) {
    suffix = 'T'
    scaledNum = bigNum.div(1e12)
  } else if (bigNum.gte(1e9)) {
    suffix = 'B'
    scaledNum = bigNum.div(1e9)
  } else if (bigNum.gte(1e6)) {
    suffix = 'M'
    scaledNum = bigNum.div(1e6)
  } else if (bigNum.gte(1e3)) {
    suffix = 'K'
    scaledNum = bigNum.div(1e3)
  }

  // Format the number with precision and trim trailing zeros
  const formattedNumber = scaledNum.toFixed(precision).replace(/\.?0+$/, '')

  return formattedNumber + suffix
}

type FormatAssetAmountOptions = Omit<FormatAmountOptions, 'decimals'> & {
  unitName?: boolean
}

/**
 * Format an asset base unit amount for display in whole units.
 * Expects the asset with AssetParams fetched from `/v2/assets/{asset-id}`.
 * Passes the amount to formatAmount with the appropriate options.
 * @param {Asset} asset - The asset to format the amount for
 * @param {number | bigint | string} amount - The asset amount to format
 * @param {FormatAssetAmountOptions} options - Options for formatting the amount
 * @param {boolean} options.unitName - Whether to append the asset unit name in the formatted amount
 * @returns {string} The formatted asset amount
 * @example
 * const asset: Asset = {
 *   index: 12345,
 *   params: {
 *     decimals: 6,
 *     'unit-name': 'TEST',
 *     // ...
 *   },
 * }
 * formatAssetAmount(asset, 1234567890) // '1,234.56789'
 * formatAssetAmount(asset, 1234567890, { precision: 2 }) // '1,234.57'
 * formatAssetAmount(asset, 1234560000, { precision: 6, trim: true }) // '1,234.56'
 * formatAssetAmount(asset, 1234567890, { compact: true, precision: 2 }) // '1.23K'
 * formatAssetAmount(asset, 1234567890n) // '1,234.56789'
 * formatAssetAmount(asset, '1234567890') // '1,234.56789'
 * formatAssetAmount(asset, 1234567890, { unitName: true }) // '1,234.56789 TEST'
 * @see {@link formatAmount}
 */
export function formatAssetAmount(
  asset: Asset,
  amount: number | bigint | string,
  options: FormatAssetAmountOptions = {},
): string {
  const { precision, trim, maxLength, compact, unitName } = options
  const decimals = Number(asset.params.decimals)
  const assetUnitName = unitName ? asset.params['unit-name'] : ''

  const formatOptions = { precision, trim, maxLength, compact, decimals }

  const result = formatAmount(amount, formatOptions)

  if (assetUnitName) {
    return `${result} ${assetUnitName}`
  }

  return result
}

/**
 * Format a MicroAlgos amount for display in Algos.
 * Passes the amount to formatAmount with the appropriate options.
 * @param {number | bigint | string} amount - The MicroAlgos amount to format
 * @param {FormatAssetAmountOptions} options - Options for formatting the amount
 * @returns {string} The formatted Algo amount
 * @example
 * formatAlgoAmount(1234567890) // '1,234.56789'
 * formatAlgoAmount(1234567890, { precision: 2 }) // '1,234.57'
 * formatAlgoAmount(1234567890, { compact: true, precision: 2 }) // '1.23K'
 * formatAlgoAmount(1234567890n) // '1,234.56789'
 * formatAlgoAmount('1234567890') // '1,234.56789'
 * @see {@link formatAmount}
 */
export function formatAlgoAmount(
  amount: number | bigint | string,
  options: FormatAssetAmountOptions = {},
): string {
  const { precision, trim, maxLength, compact } = options

  const formatOptions = { precision, trim, maxLength, compact, decimals: 6 }

  return formatAmount(amount, formatOptions)
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
 * Round a MicroAlgos amount to the nearest million (whole Algo amount)
 * @param {number | bigint} microalgos - The number of MicroAlgos to round
 * @returns {number | bigint} The rounded number
 */
export function roundToWholeAlgos<T extends number | bigint>(microalgos: T): T {
  if (typeof microalgos === 'bigint') {
    const sign = microalgos < 0n ? -1n : 1n
    const abs = microalgos < 0n ? -microalgos : microalgos
    return (((abs + 500000n) / 1000000n) * 1000000n * sign) as T
  } else {
    const sign = microalgos < 0 ? -1 : 1
    const abs = Math.abs(microalgos)
    return (Math.round(abs / 1e6) * 1e6 * sign) as T
  }
}
