import * as algokit from '@algorandfoundation/algokit-utils'
import algosdk from 'algosdk'
import { formatAlgoAmount } from '@/utils/format'
import { getAlgodConfigFromViteEnvironment } from '@/utils/network/getAlgoClientConfigs'

export class InsufficientBalanceError extends Error {
  public toastMessage: string

  constructor(
    public required: number,
    public available: number,
    action?: string,
  ) {
    const message = action
      ? `${action} failed, required balance is ${formatAlgoAmount(required)} ALGO`
      : `Required balance is ${formatAlgoAmount(required)} ALGO`
    super(message)
    this.name = 'InsufficientBalanceError'
    this.required = required
    this.available = available
    this.toastMessage = `${formatAlgoAmount(required)} ALGO required, ${formatAlgoAmount(available)} ALGO available`
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

  private async checkAccountBalance(requiredBalance: number, action?: string): Promise<void> {
    const availableBalance = await this.getAvailableBalance()
    if (availableBalance < requiredBalance) {
      throw new InsufficientBalanceError(requiredBalance, availableBalance, action)
    }
  }

  public static async check(
    address: string,
    requiredBalance: number,
    action?: string,
  ): Promise<void> {
    const checker = new BalanceChecker(address)
    await checker.checkAccountBalance(requiredBalance, action)
  }
}
