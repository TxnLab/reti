import { AxiosRequestConfig } from 'axios'
import { Nfd, NfdGetNFDParams } from '@/interfaces/nfd'
import axios from '@/lib/axios'

export async function fetchNfd(
  nameOrID: string | number,
  params?: NfdGetNFDParams,
  options?: AxiosRequestConfig,
): Promise<Nfd> {
  const { data: nfd } = await axios.get(`/nfd/${nameOrID}`, {
    ...options,
    params: { ...params, ...options?.params },
  })

  if (!nfd || !nfd.appID || !nfd.name) {
    throw new Error('NFD not found')
  }

  return nfd
}
