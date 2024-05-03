import * as algokit from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import {
  AccountBalance,
  AccountInformation,
  Asset,
  AssetCreatorHolding,
  AssetHolding,
  BlockResponse,
  Exclude,
  NodeStatusResponse,
} from '@/interfaces/algod'
import { dayjs } from '@/utils/dayjs'
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

export async function fetchSuggestedParams() {
  const suggestedParams = await algodClient.getTransactionParams().do()
  return suggestedParams
}

/**
 * Fetches the average time between blocks over a specified number of rounds.
 * @param {number} numRounds - The number of rounds to fetch.
 * @return {number} The average time between blocks in milliseconds.
 */
export async function fetchAverageBlockTime(numRounds: number = 10): Promise<number> {
  try {
    const status = (await algodClient.status().do()) as NodeStatusResponse
    if (!status) {
      throw new Error('Failed to fetch node status')
    }

    const lastRound = Number(status['last-round'])

    const blockTimes: dayjs.Dayjs[] = []
    for (let round = lastRound - numRounds; round < lastRound; round++) {
      try {
        const blockResponse = (await algodClient.block(round).do()) as BlockResponse
        const block = blockResponse.block
        blockTimes.push(dayjs.unix(block.ts))
      } catch (error) {
        throw new Error(`Unable to fetch block for round ${round}: ${error}`)
      }
    }

    if (blockTimes.length < 2) {
      throw new Error('Not enough blocks to calculate time')
    }

    let totalBlockTime = 0
    for (let i = 1; i < blockTimes.length; i++) {
      const duration = blockTimes[i].diff(blockTimes[i - 1]) // Calculate ms between blocks
      totalBlockTime += duration // Sum the durations
    }

    const averageBlockTime = totalBlockTime / (blockTimes.length - 1) // Calculate average
    return averageBlockTime
  } catch (error) {
    throw new Error(`An error occurred during block time calculation: ${error}`)
  }
}
