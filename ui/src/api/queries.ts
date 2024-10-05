import { QueryClient, keepPreviousData, queryOptions } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { CacheRequestConfig } from 'axios-cache-interceptor'
import { fetchAssetHoldings, fetchBalance, fetchBlockTimes } from '@/api/algod'
import {
  fetchMbrAmounts,
  fetchNodePoolAssignments,
  fetchPoolApy,
  fetchProtocolConstraints,
  fetchStakedInfoForPool,
  fetchStakerValidatorData,
  fetchValidator,
  fetchValidatorPools,
  fetchValidators,
} from '@/api/contracts'
import { fetchNfd, fetchNfdReverseLookup } from '@/api/nfd'
import { Nfd, NfdGetLookupParams, NfdGetNFDParams } from '@/interfaces/nfd'

export const validatorsQueryOptions = (queryClient: QueryClient) =>
  queryOptions({
    queryKey: ['validators'],
    queryFn: () => fetchValidators(queryClient),
    // staleTime: Infinity,
    retry: false,
  })

export const validatorQueryOptions = (validatorId: bigint | string) =>
  queryOptions({
    queryKey: ['validator', String(validatorId)],
    queryFn: () => fetchValidator(validatorId),
    refetchInterval: 1000 * 60, // 1 min polling on validator info
    retry: false,
  })

export const poolAssignmentQueryOptions = (validatorId: bigint | string, enabled = true) =>
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

export const assetHoldingQueryOptions = (address: string | null) =>
  queryOptions({
    queryKey: ['asset-holdings', address],
    queryFn: () => fetchAssetHoldings(address),
    enabled: !!address,
    refetchInterval: 1000 * 60 * 2, // every 2 mins
  })

export const nfdQueryOptions = (
  nameOrId: string | number,
  params: NfdGetNFDParams = { view: 'brief' },
  options: CacheRequestConfig = {},
) =>
  queryOptions({
    queryKey: ['nfd', String(nameOrId), params],
    queryFn: () => fetchNfd(String(nameOrId), params, options),
    enabled: !!nameOrId,
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 5, // 5 mins
    retry: (failureCount, error) => {
      if (error instanceof AxiosError) {
        return error.response?.status !== 404 && failureCount < 3
      }
      return false
    },
  })

export const nfdLookupQueryOptions = (
  address: string | null,
  params: Omit<NfdGetLookupParams, 'address'> = { view: 'thumbnail' },
  options: CacheRequestConfig = {},
) =>
  queryOptions<Nfd | null, AxiosError>({
    queryKey: ['nfd-lookup', address, params],
    queryFn: () => fetchNfdReverseLookup(String(address), params, options),
    enabled: !!address,
    staleTime: 1000 * 60 * 5, // 5 mins
    retry: (failureCount, error) => {
      if (error instanceof AxiosError) {
        return error.response?.status !== 404 && failureCount < 3
      }
      return false
    },
  })

export const validatorPoolsQueryOptions = (validatorId: number) =>
  queryOptions({
    queryKey: ['pools-info', validatorId],
    queryFn: () => fetchValidatorPools(validatorId),
    enabled: !!validatorId,
  })

export const stakedInfoQueryOptions = (poolAppId: bigint) =>
  queryOptions({
    queryKey: ['staked-info', poolAppId],
    queryFn: () => fetchStakedInfoForPool(poolAppId),
    enabled: !!poolAppId,
  })

export const stakesQueryOptions = (staker: string | null) =>
  queryOptions({
    queryKey: ['stakes', { staker }],
    queryFn: () => fetchStakerValidatorData(staker!),
    enabled: !!staker,
    retry: false,
    refetchInterval: 1000 * 60, // every minute
  })

export const blockTimeQueryOptions = queryOptions({
  queryKey: ['block-times'],
  queryFn: () => fetchBlockTimes(),
  staleTime: 1000 * 60 * 30, // 30 mins
})

export const poolApyQueryOptions = (poolAppId: bigint, staleTime?: number) =>
  queryOptions({
    queryKey: ['pool-apy', poolAppId],
    queryFn: () => fetchPoolApy(poolAppId),
    enabled: !!poolAppId,
    staleTime: staleTime || 1000 * 60 * 60, // 1 hour
  })
