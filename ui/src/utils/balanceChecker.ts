import * as algokit from '@algorandfoundation/algokit-utils'
import algosdk from 'algosdk'
import { formatAlgoAmount } from '@/utils/format'
import { getAlgodConfigFromViteEnvironment } from '@/utils/network/getAlgoClientConfigs'

export class InsufficientBalanceError extends Error {
  constructor(action: string, required: number, available: number) {
    const message = `${action} failed: Required balance is ${formatAlgoAmount(required)} ALGO, but available balance is ${formatAlgoAmount(available)} ALGO.`
    super(message)
    this.name = 'InsufficientBalanceError'
  }
}

export class BalanceChecker {
  private address: string
  private algodClient: algosdk.Algodv2

  private constructor(address: string) {
    this.address = address

    const algodConfig = getAlgodConfigFromViteEnvironment()
    this.algodClient = algokit.getAlgoClient({
      server: algodConfig.server,
      port: algodConfig.port,
      token: algodConfig.token,
    })
  }

  private async getAvailableBalance(): Promise<number> {
    const accountInfo = await this.algodClient.accountInformation(this.address).exclude('all').do()
    const availableBalance = Math.max(0, accountInfo.amount - accountInfo['min-balance'])
    return availableBalance
  }

  private async checkAccountBalance(requiredBalance: number, action: string): Promise<void> {
    const availableBalance = await this.getAvailableBalance()
    if (availableBalance < requiredBalance) {
      throw new InsufficientBalanceError(action, requiredBalance, availableBalance)
    }
  }

  public static async check(
    address: string,
    requiredBalance: number,
    action: string,
  ): Promise<void> {
    const checker = new BalanceChecker(address)
    await checker.checkAccountBalance(requiredBalance, action)
  }
}
