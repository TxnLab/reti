import Big from 'big.js'
import { AlgoSymbol } from '@/components/AlgoSymbol'
import { convertFromBaseUnits, formatWithPrecision } from '@/utils/format'
import { cn } from '@/utils/ui'

interface AlgoDisplayAmountProps {
  amount: number | bigint | string
  microalgos?: boolean
  trim?: boolean
  maxLength?: number
  compactPrecision?: number
  mutedRemainder?: boolean
  verticalOffset?: number
  characterOffset?: number
  sizePercent?: number
  className?: string
  symbolClassName?: string
}

export function AlgoDisplayAmount({
  amount,
  microalgos = false,
  trim = true,
  maxLength,
  compactPrecision = 1,
  mutedRemainder = false,
  verticalOffset,
  characterOffset,
  sizePercent,
  className = '',
  symbolClassName = '',
}: AlgoDisplayAmountProps) {
  const classes = cn('whitespace-nowrap', className)
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : Number(amount)

  const formatted = microalgos
    ? convertFromBaseUnits(numAmount, 6).toFixed(6)
    : new Big(numAmount).toFixed(6)

  const parts = formatted.split('.')

  if (trim && parts.length === 2) {
    parts[1] = parts[1].replace(/\.?0+$/, '')
  }

  if (maxLength && parts.join('.').length > maxLength) {
    return (
      <span className={classes}>
        <AlgoSymbol
          className={symbolClassName}
          verticalOffset={verticalOffset}
          characterOffset={characterOffset}
          sizePercent={sizePercent}
        />
        {formatWithPrecision(parseFloat(formatted), compactPrecision)}
      </span>
    )
  }

  parts[0] = new Intl.NumberFormat().format(parseFloat(parts[0]))

  return (
    <span className={classes}>
      <AlgoSymbol
        className={symbolClassName}
        verticalOffset={verticalOffset}
        characterOffset={characterOffset}
        sizePercent={sizePercent}
      />
      {parts[0]}
      <span
        className={cn(
          parts[1] === '' ? 'hidden' : mutedRemainder ? 'text-muted-foreground/50' : '',
        )}
      >{`.${parts[1]}`}</span>
    </span>
  )
}
