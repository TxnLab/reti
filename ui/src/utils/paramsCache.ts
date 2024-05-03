import * as algokit from '@algorandfoundation/algokit-utils'
import algosdk from 'algosdk'
import { getAlgodConfigFromViteEnvironment } from '@/utils/network/getAlgoClientConfigs'

const algodConfig = getAlgodConfigFromViteEnvironment()

interface CachedParams {
  suggestedParams: algosdk.SuggestedParams
  timestamp: number
}

export class ParamsCache {
  private static readonly instance: ParamsCache = new ParamsCache()
  private client: algosdk.Algodv2
  private cache: CachedParams | null = null

  private constructor() {
    this.client = algokit.getAlgoClient({
      server: algodConfig.server,
      port: algodConfig.port,
      token: algodConfig.token,
    })
  }

  public static async getSuggestedParams(): Promise<algosdk.SuggestedParams> {
    return this.instance.fetchAndCacheParams()
  }

  private async fetchAndCacheParams(): Promise<algosdk.SuggestedParams> {
    const now = Date.now()
    const staleTime = 1000 * 60 * 5 // 5 minutes

    if (this.cache && now - this.cache.timestamp < staleTime) {
      return this.cache.suggestedParams
    }

    const suggestedParams = await this.client.getTransactionParams().do()
    this.cache = {
      suggestedParams,
      timestamp: now,
    }
    return suggestedParams
  }
}
