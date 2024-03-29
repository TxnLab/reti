import { AxiosResponse, AxiosRequestConfig } from 'axios'
import { Nfd, NfdGetNFDParams } from '@/interfaces/nfd'
import axios from '@/lib/axios'

export function fetchNfd(
  nameOrID: string,
  params?: NfdGetNFDParams,
  options?: AxiosRequestConfig,
): Promise<AxiosResponse<Nfd | void>> {
  return axios.get(`/nfd/${nameOrID}`, {
    ...options,
    params: { ...params, ...options?.params },
  })
}
