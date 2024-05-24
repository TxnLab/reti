import { AxiosError } from 'axios'
import { CacheRequestConfig } from 'axios-cache-interceptor'
import {
  Nfd,
  NfdGetLookup200,
  NfdGetLookupParams,
  NfdGetNFDParams,
  NfdSearchV2Params,
  NfdV2SearchRecords,
} from '@/interfaces/nfd'
import axios from '@/lib/axios'

export async function fetchNfd(
  nameOrID: string | number,
  params?: NfdGetNFDParams,
  options?: CacheRequestConfig,
): Promise<Nfd> {
  const { data: nfd } = await axios.get<Nfd>(`/nfd/${nameOrID}`, {
    ...options,
    params: { ...params, ...options?.params },
  })

  if (!nfd || !nfd.name) {
    throw new Error('NFD not found')
  }

  return nfd
}

export async function fetchNfdSearch(
  params: NfdSearchV2Params,
  options?: CacheRequestConfig,
): Promise<NfdV2SearchRecords> {
  const { data: result } = await axios.get<NfdV2SearchRecords>(`/nfd/v2/search`, {
    ...options,
    params: { ...params, ...options?.params },
  })

  return result
}

export async function fetchNfdReverseLookup(
  address: string,
  params?: Omit<NfdGetLookupParams, 'address'>,
  options?: CacheRequestConfig,
): Promise<Nfd | null> {
  try {
    const { data } = await axios.get<NfdGetLookup200>(`/nfd/lookup`, {
      ...options,
      params: { address: [address], ...params, ...options?.params },
    })

    const nfd = data[address]

    return nfd || null
  } catch (error) {
    if (error instanceof AxiosError && error.response?.status === 404) {
      return null
    }
    throw error
  }
}

export async function fetchNfdReverseLookups(
  params: NfdGetLookupParams,
  options?: CacheRequestConfig,
): Promise<NfdGetLookup200> {
  const { data } = await axios.get<NfdGetLookup200>(`/nfd/lookup`, {
    ...options,
    params: { ...params, ...options?.params },
  })

  return data
}
