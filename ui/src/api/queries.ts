import { queryOptions } from '@tanstack/react-query'
import {
  fetchMbrAmounts,
  fetchNodePoolAssignments,
  fetchProtocolConstraints,
  fetchValidator,
  fetchValidators,
} from '@/api/contracts'

export const validatorsQueryOptions = queryOptions({
  queryKey: ['validators'],
  queryFn: () => fetchValidators(),
  // staleTime: Infinity,
  retry: false,
})

export const validatorQueryOptions = (validatorId: number | string) =>
  queryOptions({
    queryKey: ['validator', String(validatorId)],
    queryFn: () => fetchValidator(validatorId),
    // staleTime: Infinity,
    retry: false,
  })

export const poolAssignmentQueryOptions = (validatorId: number | string, enabled = true) =>
  queryOptions({
    queryKey: ['pool-assignments', String(validatorId)],
    queryFn: () => fetchNodePoolAssignments(validatorId),
    enabled,
  })

export const mbrQueryOptions = queryOptions({
  queryKey: ['mbr'],
  queryFn: () => fetchMbrAmounts(),
  staleTime: Infinity,
})

export const constraintsQueryOptions = queryOptions({
  queryKey: ['constraints'],
  queryFn: () => fetchProtocolConstraints(),
  staleTime: Infinity,
})
