import { queryOptions } from '@tanstack/react-query'
import { fetchBalance } from '@/api/algod'
import {
  fetchMbrAmounts,
  fetchNodePoolAssignments,
  fetchProtocolConstraints,
  fetchValidator,
  fetchValidators,
} from '@/api/contracts'
import { fetchNfd } from '@/api/nfd'
import { NfdGetNFDParams } from '@/interfaces/nfd'

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
  staleTime: 1000 * 60 * 30, // every 30 mins
})

export const balanceQueryOptions = (address: string | null) =>
  queryOptions({
    queryKey: ['account-balance', address],
    queryFn: () => fetchBalance(address),
    enabled: !!address,
    refetchInterval: 1000 * 30,
  })

export const nfdQueryOptions = (
  nameOrId: string | number,
  params: NfdGetNFDParams = { view: 'brief' },
) =>
  queryOptions({
    queryKey: ['nfd', String(nameOrId), params],
    queryFn: () => fetchNfd(String(nameOrId), params),
    enabled: !!nameOrId,
  })
