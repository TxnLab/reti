import { AxiosRequestConfig } from 'axios'
import { Nfd, NfdGetNFDParams, NfdSearchV2Params, NfdV2SearchRecords } from '@/interfaces/nfd'
import axios from '@/lib/axios'

export async function fetchNfd(
  nameOrID: string | number,
  params?: NfdGetNFDParams,
  options?: AxiosRequestConfig,
): Promise<Nfd> {
  const { data: nfd } = await axios.get<Nfd>(`/nfd/${nameOrID}`, {
    ...options,
    params: { ...params, ...options?.params },
  })

  if (!nfd || !nfd.appID || !nfd.name) {
    throw new Error('NFD not found')
  }

  return nfd
}

export async function fetchNfdSearch(
  params: NfdSearchV2Params,
  options?: AxiosRequestConfig,
): Promise<NfdV2SearchRecords> {
  const { data: result } = await axios.get<NfdV2SearchRecords>(`/nfd/v2/search`, {
    ...options,
    params: { ...params, ...options?.params },
  })

  return result
}
