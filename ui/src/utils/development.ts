import * as algokit from '@algorandfoundation/algokit-utils'
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { QueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import algosdk from 'algosdk'
import { toast } from 'sonner'
import { epochBalanceUpdate } from '@/api/contracts'
import { Validator, ValidatorPoolKey } from '@/interfaces/validator'
import { getAlgodConfigFromViteEnvironment } from '@/utils//network/getAlgoClientConfigs'

const algodConfig = getAlgodConfigFromViteEnvironment()
const algodClient = algokit.getAlgoClient({
  server: algodConfig.server,
  port: algodConfig.port,
  token: algodConfig.token,
})

export async function simulateEpoch(
  validator: Validator,
  poolKey: ValidatorPoolKey,
  rewardAmount: number,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
  queryClient: QueryClient,
  router: ReturnType<typeof useRouter>,
) {
  const toastId = 'simulateEpoch'

  try {
    if (!activeAddress) {
      throw new Error('No active wallet found')
    }

    await algodClient.setBlockOffsetTimestamp(validator.payoutFrequency * 60).do()

    toast.loading('Sign transactions to send rewards to pool', { id: toastId })

    await algokit.transferAlgos(
      {
        from: { signer, addr: activeAddress } as TransactionSignerAccount,
        to: algosdk.getApplicationAddress(poolKey.poolAppId),
        amount: AlgoAmount.Algos(rewardAmount),
      },
      algodClient,
    )

    toast.loading('Running epoch balance update', { id: toastId })

    await epochBalanceUpdate(poolKey.poolAppId, signer, activeAddress)

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
