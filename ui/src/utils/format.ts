import Big from 'big.js'

export type RoundingMode = 'roundDown' | 'roundUp' | 'roundHalfUp' | 'roundHalfEven'

export function convertFromBaseUnits(amount: number, decimals = 0, rm: RoundingMode = 'roundDown') {
  if (decimals === 0) return amount
  const divisor = new Big(10).pow(decimals)
  const baseUnits = new Big(amount).round(decimals, Big[rm])
  return baseUnits.div(divisor).toNumber()
}

export function convertToBaseUnits(amount: number, decimals = 0, rm: RoundingMode = 'roundDown') {
  if (decimals === 0) return amount
  const multiplier = new Big(10).pow(decimals)
  const wholeUnits = new Big(amount).round(decimals, Big[rm])
  return wholeUnits.times(multiplier).toNumber()
}

export function formatWithPrecision(num: number, precision: number) {
  let scaledNum = num
  let suffix = ''
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
  return scaledNum.toFixed(precision) + suffix
}

export function formatAssetAmount(
  amount: number | string,
  baseUnits = false,
  decimals = 6,
  trim = true,
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

export function formatAlgoAmount(
  amount: number | string,
  microalgos = false,
  trim = true,
  maxLength?: number,
): string {
  return formatAssetAmount(amount, microalgos, 6, trim, maxLength)
}

export function roundToFirstNonZeroDecimal(num: number): number {
  if (num === 0) return 0

  // Convert the number to exponential format to easily find the exponent
  const expForm = num.toExponential().split('e')
  const exponent = parseInt(expForm[1])

  // Calculate the number of decimal places needed
  const decimalPlaces = Math.abs(exponent)

  // Use toFixed to round to the first significant decimal place
  return Number(num.toFixed(decimalPlaces))
}

type FormatNumberOptions = {
  compact?: boolean
  precision?: number
  trim?: boolean
}

export function formatNumber(amount: number | bigint | string, options: FormatNumberOptions = {}) {
  const { compact = false, precision = 0, trim = true } = options
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : Number(amount)

  let formatted = new Big(numAmount).toFixed(precision)
  const parts = formatted.split('.')

  if (trim && parts.length === 2) {
    parts[1] = parts[1].replace(/\.?0+$/, '')

    if (parts[1] === '') {
      formatted = parts[0]
    } else {
      formatted = parts.join('.')
    }
  }

  if (compact) {
    return formatWithPrecision(parseFloat(formatted), precision)
  }

  return (parts[0] = new Intl.NumberFormat().format(parseFloat(parts[0])))
}
