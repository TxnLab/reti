import * as algokit from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { QueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import algosdk from 'algosdk'
import { toast } from 'sonner'
import { epochBalanceUpdate } from '@/api/contracts'
import { StakerPoolData } from '@/interfaces/staking'
import { Validator } from '@/interfaces/validator'
import { getAlgodConfigFromViteEnvironment } from '@/utils/network/getAlgoClientConfigs'

const algodConfig = getAlgodConfigFromViteEnvironment()
const algodClient = algokit.getAlgoClient({
  server: algodConfig.server,
  port: algodConfig.port,
  token: algodConfig.token,
})

export async function simulateEpoch(
  validator: Validator,
  pools: StakerPoolData[],
  rewardAmount: number,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
  queryClient: QueryClient,
  router: ReturnType<typeof useRouter>,
) {
  const toastId = 'simulate-epoch'

  try {
    if (!activeAddress) {
      throw new Error('No active wallet found')
    }

    // Set block time to payout frequency (in seconds)
    await algodClient.setBlockOffsetTimestamp(validator.config.payoutEveryXMins * 60).do()

    toast.loading(
      `Sign to send ${AlgoAmount.Algos(rewardAmount).algos} ALGO reward to ` +
        `${`${pools.length} pool${pools.length > 1 ? 's' : ''}`}`,
      { id: toastId },
    )

    const atc = new algosdk.AtomicTransactionComposer()
    const suggestedParams = await algodClient.getTransactionParams().do()

    for (const pool of pools) {
      const poolKey = pool.poolKey

      const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: activeAddress,
        suggestedParams,
        to: algosdk.getApplicationAddress(poolKey.poolAppId),
        amount: AlgoAmount.Algos(rewardAmount).microAlgos,
      })

      atc.addTransaction({ txn: paymentTxn, signer })
    }

    await atc.execute(algodClient, 4)

    // Reset block time
    await algodClient.setBlockOffsetTimestamp(0).do()

    for (const pool of pools) {
      const poolKey = pool.poolKey
      toast.loading(`Sign for Pool ${poolKey.poolId} epoch balance update`, { id: toastId })

      await epochBalanceUpdate(poolKey.poolAppId, signer, activeAddress)
    }

    toast.success('Epoch balance update complete!', { id: toastId })

    queryClient.invalidateQueries({ queryKey: ['stakes', { staker: activeAddress }] })
    router.invalidate()
  } catch (error) {
    toast.error('Error simulating epoch', { id: toastId })

    console.error(error)
    throw error
  } finally {
    await algodClient.setBlockOffsetTimestamp(0).do()
  }
}
