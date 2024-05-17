import * as algokit from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import {
  AccountBalance,
  AccountInformation,
  AlgodHttpError,
  Asset,
  AssetCreatorHolding,
  AssetHolding,
  BlockResponse,
  Exclude,
  NodeStatusResponse,
} from '@/interfaces/algod'
import { getAlgodConfigFromViteEnvironment } from '@/utils/network/getAlgoClientConfigs'

const algodConfig = getAlgodConfigFromViteEnvironment()
const algodClient = algokit.getAlgoClient({
  server: algodConfig.server,
  port: algodConfig.port,
  token: algodConfig.token,
})

export async function fetchAccountInformation(
  address: string,
  exclude: Exclude = 'none',
): Promise<AccountInformation> {
  const accountInfo = await algodClient.accountInformation(address).exclude(exclude).do()
  return accountInfo as AccountInformation
}

export async function fetchAccountBalance(
  address: string,
  availableBalance = false,
): Promise<number> {
  const accountInfo = await fetchAccountInformation(address, 'all')

  return availableBalance ? accountInfo.amount - accountInfo['min-balance'] : accountInfo.amount
}

export async function fetchAsset(assetId: number): Promise<Asset> {
  const asset = await algodClient.getAssetByID(assetId).do()
  return asset as Asset
}

export async function fetchBalance(address: string | null): Promise<AccountBalance> {
  if (!address) {
    throw new Error('No address provided')
  }
  const accountInfo = await fetchAccountInformation(address, 'all')

  const amount = accountInfo.amount
  const minimum = accountInfo['min-balance']
  const available = Math.max(0, amount - minimum)

  return {
    amount: AlgoAmount.MicroAlgos(amount),
    available: AlgoAmount.MicroAlgos(available),
    minimum: AlgoAmount.MicroAlgos(minimum),
  }
}

export async function fetchAssetHoldings(address: string | null): Promise<AssetHolding[]> {
  if (!address) {
    throw new Error('No address provided')
  }
  const accountInfo = await fetchAccountInformation(address)
  const assets = accountInfo.assets || []
  return assets
}

export async function fetchAccountAssetInformation(
  address: string | null,
  assetId: number,
): Promise<AssetHolding> {
  if (!address) {
    throw new Error('No address provided')
  }
  if (!assetId) {
    throw new Error('No assetId provided')
  }
  try {
    const assetHolding = await algodClient.accountAssetInformation(address, assetId).do()
    return assetHolding as AssetHolding
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (error.message && error.response) {
      throw new AlgodHttpError(error.message, error.response)
    } else {
      throw error
    }
  }
}

export async function isOptedInToAsset(address: string | null, assetId: number): Promise<boolean> {
  try {
    await fetchAccountAssetInformation(address, assetId)
    return true
  } catch (error: unknown) {
    if (error instanceof AlgodHttpError && error.response.status === 404) {
      return false
    } else {
      throw error
    }
  }
}

export async function fetchAssetCreatorHoldings(
  address: string | null,
): Promise<AssetCreatorHolding[]> {
  if (!address) {
    throw new Error('No address provided')
  }
  const assetHoldings = await fetchAssetHoldings(address)

  const chunkArray = <T>(arr: T[], chunkSize: number): T[][] => {
    const chunks: T[][] = []
    for (let i = 0; i < arr.length; i += chunkSize) {
      chunks.push(arr.slice(i, i + chunkSize))
    }
    return chunks
  }

  const allAssetCreatorHoldings: AssetCreatorHolding[] = []
  const batchSize = 10

  // Split the assetHoldings into batches of 10
  const batches = chunkArray(assetHoldings, batchSize)

  for (const batch of batches) {
    const promises = batch.map((holding) => fetchAsset(holding['asset-id']))
    const assets = await Promise.all(promises)
    const assetCreatorHoldings = assets.map((asset, index) => {
      return {
        ...batch[index],
        creator: asset.params.creator,
      }
    })
    allAssetCreatorHoldings.push(...assetCreatorHoldings)
  }

  return allAssetCreatorHoldings
}

/**
 * Fetches timestamps for the last `numRounds` blocks
 * @param {number} numRounds - The number of rounds to fetch
 * @return {number[]} - An array of timestamps for each block
 */
export async function fetchBlockTimes(numRounds: number = 10): Promise<number[]> {
  try {
    const status = (await algodClient.status().do()) as NodeStatusResponse
    if (!status) {
      throw new Error('Failed to fetch node status')
    }

    const lastRound = Number(status['last-round'])

    const blockTimes: number[] = []
    for (let round = lastRound - numRounds; round < lastRound; round++) {
      try {
        const blockResponse = (await algodClient.block(round).do()) as BlockResponse
        const block = blockResponse.block
        blockTimes.push(block.ts)
      } catch (error) {
        throw new Error(`Unable to fetch block for round ${round}: ${error}`)
      }
    }

    return blockTimes
  } catch (error) {
    throw new Error(`An error occurred during block time calculation: ${error}`)
  }
}
