import { useQuery } from '@tanstack/react-query'
import { blockTimeQueryOptions } from '@/api/queries'
import { calculateAverageBlockTime } from '@/utils/blocks'
import { formatAmount } from '@/utils/format'

export interface BlockTime {
  ms: number
  secs: number
}

export function useBlockTime(): BlockTime {
  const { data: timestamps = [] } = useQuery(blockTimeQueryOptions)
  const ms = calculateAverageBlockTime(timestamps)
  const secs = ms ? Number(formatAmount(ms / 1000, { precision: 1, trim: true })) : 0

  return { ms, secs }
}
