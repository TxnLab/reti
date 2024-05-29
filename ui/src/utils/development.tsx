import * as algokit from '@algorandfoundation/algokit-utils'
import { getTestAccount } from '@algorandfoundation/algokit-utils/testing'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { QueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import algosdk from 'algosdk'
import { toast } from 'sonner'
import { fetchAccountInformation, fetchAsset } from '@/api/algod'
import { epochBalanceUpdate } from '@/api/contracts'
import { StakerPoolData } from '@/interfaces/staking'
import { ToStringTypes } from '@/interfaces/utils'
import { Validator, ValidatorConfig } from '@/interfaces/validator'
import { InsufficientBalanceError } from '@/utils/balanceChecker'
import { convertToStringTypes } from '@/utils/convert'
import { convertToBaseUnits, formatAssetAmount } from '@/utils/format'
import { getAlgodConfigFromViteEnvironment } from '@/utils/network/getAlgoClientConfigs'
import { ParamsCache } from '@/utils/paramsCache'

const algodConfig = getAlgodConfigFromViteEnvironment()
const algodClient = algokit.getAlgoClient({
  server: algodConfig.server,
  port: algodConfig.port,
  token: algodConfig.token,
})

async function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function incrementRoundNumberBy(rounds: number) {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('Increment round number is only available in development mode')
  }

  const startParams = await algodClient.getTransactionParams().do()

  let result = {
    rounds,
    startRound: startParams.firstRound,
    resultRound: startParams.firstRound,
  }

  if (rounds === 0) {
    return result
  }

  // console.log(`Increment round number start: ${result.startRound}`)

  const kmdClient = algokit.getAlgoKmdClient({
    server: algodConfig.server,
    port: algodConfig.port,
    token: algodConfig.token,
  })

  const testAccount = await getTestAccount(
    { initialFunds: AlgoAmount.Algos(10), suppressLog: true },
    algodClient,
    kmdClient,
  )

  let txnId = ''
  for (let i = 0; i < rounds; i++) {
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: testAccount.addr,
      to: testAccount.addr,
      amount: 0,
      note: new TextEncoder().encode(`${i}`),
      suggestedParams: startParams,
    })

    const signedTransaction = await algokit.signTransaction(txn, testAccount)
    const { txId } = await algodClient.sendRawTransaction(signedTransaction).do()
    txnId = txId
  }

  await algokit.waitForConfirmation(txnId, rounds + 1, algodClient)

  const resultParams = await algodClient.getTransactionParams().do()

  result = {
    ...result,
    resultRound: resultParams.firstRound,
  }
  // console.log(`Increment round number result: ${result.resultRound}`)

  return result
}

export async function triggerPoolPayouts(
  pools: StakerPoolData[],
  signer: algosdk.TransactionSigner,
  activeAddress: string,
  authAddr: string | undefined,
) {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('Triggering pool payouts is only available in development mode')
  }

  function createNextItemPromise(): [Promise<void>, () => void] {
    let resolveNextItem: () => void
    const nextItemPromise = new Promise<void>((resolve) => {
      resolveNextItem = resolve
    })
    return [nextItemPromise, resolveNextItem!]
  }

  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i]
    const poolAppId = pool.poolKey.poolAppId
    const poolId = pool.poolKey.poolId

    const isLastPool = i === pools.length - 1

    const promiseFunction = epochBalanceUpdate(poolAppId, signer, activeAddress, authAddr)

    const [nextItemPromise, resolveNextItem] = createNextItemPromise()

    toast.promise(promiseFunction, {
      loading: `Sign for Pool ${poolId} payout`,
      success: () =>
        !isLastPool ? (
          <div className="flex items-center justify-between w-full">
            Pool {i + 1}/{pools.length} payout complete!
            <button
              data-button
              className="group-[.toast]:bg-primary group-[.toast]:text-primary-foreground"
              onClick={() => resolveNextItem()}
            >
              Next pool
            </button>
          </div>
        ) : (
          'Epoch balance update complete!'
        ),
      error: `Error triggering Pool ${poolId} payout`,
    })

    await promiseFunction

    if (!isLastPool) {
      await nextItemPromise
    }
  }
}

export async function simulateEpoch(
  validator: Validator,
  pools: StakerPoolData[],
  rewardAmount: number,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
  authAddr: string | undefined,
  queryClient: QueryClient,
  router: ReturnType<typeof useRouter>,
) {
  const toastId = 'simulate-epoch'

  try {
    if (process.env.NODE_ENV !== 'development') {
      throw new Error('Simulate epoch is only available in development mode')
    }

    if (!activeAddress) {
      throw new Error('No active wallet found')
    }

    toast.loading(
      `Sign to send ${AlgoAmount.Algos(rewardAmount).algos} ALGO reward to ` +
        `${`${pools.length} pool${pools.length > 1 ? 's' : ''}`}`,
      { id: toastId },
    )

    const atc = new algosdk.AtomicTransactionComposer()
    const suggestedParams = await algodClient.getTransactionParams().do()

    // Create atomic transaction to send rewards to each pool
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

    // Send rewards to each pool
    await atc.execute(algodClient, 4)

    toast.success('ALGO rewards sent to pools!', { id: toastId, duration: 3000 })

    await wait(3000)

    // Calculate the number of rounds to simulate an epoch
    const { epochRoundLength } = validator.config
    const numRounds = Math.ceil(320 + epochRoundLength + epochRoundLength / 2)

    // Pass promise to toast.promise to handle loading, success, and error states
    const incrementPromise = incrementRoundNumberBy(numRounds)
    toast.promise(incrementPromise, {
      loading: 'Simulating epoch...',
      success: (data) => (
        <span className="text-foreground">
          Simulated {data.rounds} rounds:{' '}
          <span className="whitespace-nowrap">
            {data.startRound} &rarr; {data.resultRound}
          </span>
        </span>
      ),
      error: 'Error simulating epoch',
      duration: 3000,
    })

    // Simulate the epoch
    await incrementPromise

    await wait(3000)

    // Trigger payouts by calling epochBalanceUpdate, starting with first pool (will iterate through all pools)
    await triggerPoolPayouts(pools, signer, activeAddress, authAddr)

    queryClient.invalidateQueries({ queryKey: ['stakes', { staker: activeAddress }] })
    router.invalidate()
  } catch (error) {
    if (error instanceof InsufficientBalanceError) {
      toast.error('Insufficient balance', {
        id: toastId,
        description: error.toastMessage,
        duration: 5000,
      })
    } else {
      toast.error('Error simulating epoch', { id: toastId })
    }
    console.error(error)
    throw error
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
    const asset = await fetchAsset(tokenId)
    const unitName = asset.params['unit-name']

    toast.loading(`Sign to send ${rewardTokenAmount} ${unitName} tokens to pool`, {
      id: toastId,
    })

    // Pool 1 holds the reward tokens
    const poolAppId = validator.pools[0].poolAppId
    const poolAddress = algosdk.getApplicationAddress(poolAppId)

    const atc = new algosdk.AtomicTransactionComposer()
    const suggestedParams = await ParamsCache.getSuggestedParams()

    const assetTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: activeAddress,
      to: poolAddress,
      assetIndex: tokenId,
      amount: convertToBaseUnits(rewardTokenAmount, 6),
      suggestedParams,
    })

    atc.addTransaction({ txn: assetTxn, signer })
    await atc.execute(algodClient, 4)

    const poolAccountInfo = await fetchAccountInformation(poolAddress)
    const assetHolding = poolAccountInfo.assets?.find((a) => a['asset-id'] === tokenId)

    const balanceStr = formatAssetAmount(asset, assetHolding?.amount || 0)
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
    epochRoundLength: '60',
    percentToValidator: '5',
    validatorCommissionAddress: address,
    minEntryStake: '1000',
    poolsPerNode: '3',
    ...stringParams,
  } as Partial<ToStringTypes<ValidatorConfig>>
}
