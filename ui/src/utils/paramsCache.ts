import * as algokit from '@algorandfoundation/algokit-utils'
import algosdk from 'algosdk'
import { getAlgodConfigFromViteEnvironment } from '@/utils/network/getAlgoClientConfigs'

interface CachedParams {
  suggestedParams: algosdk.SuggestedParams
  timestamp: number
}

/**
 * This singleton class should be used to fetch suggested transaction parameters.
 * It will cache the parameters for 5 minutes to avoid refetching for every transaction.
 * @method getSuggestedParams - Static method to fetch suggested transaction parameters
 * @returns {Promise<algosdk.SuggestedParams>} Suggested transaction parameters
 * @example
 * const suggestedParams = await ParamsCache.getSuggestedParams()
 * @see {@link https://developer.algorand.org/docs/rest-apis/algod/#get-v2transactionsparams}
 */
export class ParamsCache {
  private static instance: ParamsCache | null = null
  private client: algosdk.Algodv2
  private cache: CachedParams | null = null

  private constructor() {
    const algodConfig = getAlgodConfigFromViteEnvironment()
    this.client = algokit.getAlgoClient({
      server: algodConfig.server,
      port: algodConfig.port,
      token: algodConfig.token,
    })
  }

  public static async getSuggestedParams(): Promise<algosdk.SuggestedParams> {
    if (!this.instance) {
      this.instance = new ParamsCache()
    }
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

  // Reset instance for testing purposes
  public static resetInstance() {
    this.instance = null
  }
}
