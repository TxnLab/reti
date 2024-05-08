import { queryOptions } from '@tanstack/react-query'
import { fetchAssetHoldings, fetchBalance, fetchBlockTimes } from '@/api/algod'
import {
  fetchMbrAmounts,
  fetchNodePoolAssignments,
  fetchProtocolConstraints,
  fetchStakedInfoForPool,
  fetchStakerValidatorData,
  fetchValidator,
  fetchValidatorPools,
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
    refetchInterval: 1000 * 60, // 1 min polling on validator info
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
) =>
  queryOptions({
    queryKey: ['nfd', String(nameOrId), params],
    queryFn: () => fetchNfd(String(nameOrId), params),
    enabled: !!nameOrId,
  })

export const validatorPoolsQueryOptions = (validatorId: number) =>
  queryOptions({
    queryKey: ['pools-info', validatorId],
    queryFn: () => fetchValidatorPools(validatorId),
    enabled: !!validatorId,
  })

export const stakedInfoQueryOptions = (poolAppId: number) =>
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
  staleTime: 1000 * 60 * 30, // every 30 mins
})
