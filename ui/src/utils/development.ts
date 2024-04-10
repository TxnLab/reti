import * as algokit from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { QueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import algosdk from 'algosdk'
import { toast } from 'sonner'
import { getAccountInformation, getAsset } from '@/api/algod'
import { epochBalanceUpdate } from '@/api/contracts'
import { StakerPoolData } from '@/interfaces/staking'
import { ToStringTypes } from '@/interfaces/utils'
import { Validator, ValidatorConfig } from '@/interfaces/validator'
import { convertToStringTypes } from '@/utils/convert'
import { convertToBaseUnits, formatAssetAmount } from '@/utils/format'
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
        to: algosdk.getApplicationAddress(poolKey.poolAppId),
        amount: AlgoAmount.Algos(rewardAmount).microAlgos,
        suggestedParams,
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

export async function sendRewardTokensToPool(
  validator: Validator,
  rewardTokenAmount: number,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
) {
  const toastId = 'send-reward-tokens-to-pool'

  try {
    const tokenId = validator.config.rewardTokenId
    const asset = await getAsset(tokenId)
    const unitName = asset.params['unit-name']

    toast.loading(`Sign to send ${rewardTokenAmount} ${unitName} tokens to pool`, {
      id: toastId,
    })

    // Pool 1 holds the reward tokens
    const poolAppId = validator.pools[0].poolAppId
    const poolAddress = algosdk.getApplicationAddress(poolAppId)

    const atc = new algosdk.AtomicTransactionComposer()
    const suggestedParams = await algodClient.getTransactionParams().do()

    const assetTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: activeAddress,
      to: poolAddress,
      assetIndex: tokenId,
      amount: convertToBaseUnits(rewardTokenAmount, 6),
      suggestedParams,
    })

    atc.addTransaction({ txn: assetTxn, signer })
    await atc.execute(algodClient, 4)

    const poolAccountInfo = await getAccountInformation(poolAddress)
    const assetHolding = poolAccountInfo.assets?.find((a) => a['asset-id'] === tokenId)

    const balanceStr = formatAssetAmount(
      assetHolding?.amount || 0,
      true,
      Number(asset.params.decimals),
    )
    const balanceMsg = assetHolding?.amount ? `${balanceStr} ${unitName}` : 'unknown'

    toast.success(`Success! New Balance: ${balanceMsg}`, {
      id: toastId,
    })
  } catch (error) {
    toast.error('Error sending reward tokens to pool', { id: toastId })

    console.error(error)
    throw error
  }
}

export function validatorAutoFill(
  address: string,
  params: Partial<ValidatorConfig> = {},
): Partial<ToStringTypes<ValidatorConfig>> {
  const stringParams = convertToStringTypes(params)
  return {
    owner: address,
    manager: address,
    payoutEveryXMins: '60',
    percentToValidator: '5',
    validatorCommissionAddress: address,
    minEntryStake: '1000',
    poolsPerNode: '3',
    ...stringParams,
  }
}

export async function createGatingToken(
  signer: algosdk.TransactionSigner,
  activeAddress: string,
  total: bigint,
  decimals: number,
  assetName?: string,
  unitName?: string,
) {
  const atc = new algosdk.AtomicTransactionComposer()
  const suggestedParams = await algodClient.getTransactionParams().do()

  const assetCreateTxn = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
    from: activeAddress,
    suggestedParams,
    total: Number(total),
    decimals,
    defaultFrozen: false,
    unitName,
    assetName,
    manager: activeAddress,
    reserve: activeAddress,
    freeze: activeAddress,
    clawback: activeAddress,
    assetURL: 'https://github.com/TxnLab/reti',
  })

  atc.addTransaction({ txn: assetCreateTxn, signer })
  const result = await atc.execute(algodClient, 4)

  const txId = result.txIDs[0]
  const txnInfo = await algodClient.pendingTransactionInformation(txId).do()
  const assetId = txnInfo['asset-index']

  return Number(assetId)
}
