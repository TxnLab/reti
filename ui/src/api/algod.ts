import * as algokit from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { AccountBalance, AccountInformation, Asset, Exclude } from '@/interfaces/algod'
import { getAlgodConfigFromViteEnvironment } from '@/utils/network/getAlgoClientConfigs'

const algodConfig = getAlgodConfigFromViteEnvironment()
const algodClient = algokit.getAlgoClient({
  server: algodConfig.server,
  port: algodConfig.port,
  token: algodConfig.token,
})

export async function getAccountInformation(
  address: string,
  exclude: Exclude = 'none',
): Promise<AccountInformation> {
  const accountInfo = await algodClient.accountInformation(address).exclude(exclude).do()
  return accountInfo as AccountInformation
}

export async function getAccountBalance(
  address: string,
  availableBalance = false,
): Promise<number> {
  const accountInfo = await getAccountInformation(address, 'all')

  return availableBalance ? accountInfo.amount - accountInfo['min-balance'] : accountInfo.amount
}

export async function getAsset(assetId: number): Promise<Asset> {
  const asset = await algodClient.getAssetByID(assetId).do()
  return asset as Asset
}

export async function fetchBalance(address: string | null): Promise<AccountBalance> {
  if (!address) {
    throw new Error('No address provided')
  }
  const accountInfo = await getAccountInformation(address, 'all')

  const amount = accountInfo.amount
  const minimum = accountInfo['min-balance']
  const available = Math.max(0, amount - minimum)

  return {
    amount: AlgoAmount.MicroAlgos(amount),
    available: AlgoAmount.MicroAlgos(available),
    minimum: AlgoAmount.MicroAlgos(minimum),
  }
}
