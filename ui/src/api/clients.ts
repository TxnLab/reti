import * as algokit from '@algorandfoundation/algokit-utils'
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import algosdk from 'algosdk'
import { FEE_SINK } from '@/constants/accounts'
import { StakingPoolClient } from '@/contracts/StakingPoolClient'
import { ValidatorRegistryClient } from '@/contracts/ValidatorRegistryClient'
import { makeEmptyTransactionSigner } from '@/lib/makeEmptyTransactionSigner'
import { getRetiAppIdFromViteEnvironment } from '@/utils/env'
import { getAlgodConfigFromViteEnvironment } from '@/utils/network/getAlgoClientConfigs'
import { ParamsCache } from '@/utils/paramsCache'

const algodConfig = getAlgodConfigFromViteEnvironment()
const algodClient = algokit.getAlgoClient({
  server: algodConfig.server,
  port: algodConfig.port,
  token: algodConfig.token,
})

const RETI_APP_ID = getRetiAppIdFromViteEnvironment()

export async function getValidatorClient(
  signer: algosdk.TransactionSigner,
  activeAddress: string,
): Promise<ValidatorRegistryClient> {
  const params = await ParamsCache.getSuggestedParams()

  return new ValidatorRegistryClient(
    {
      sender: { signer, addr: activeAddress },
      resolveBy: 'id',
      id: RETI_APP_ID,
      params,
    },
    algodClient,
  )
}

export async function getSimulateValidatorClient(
  senderAddr: string = FEE_SINK,
  authAddr?: string,
): Promise<ValidatorRegistryClient> {
  const params = await ParamsCache.getSuggestedParams()

  return new ValidatorRegistryClient(
    {
      sender: { addr: senderAddr, signer: makeEmptyTransactionSigner(authAddr) },
      resolveBy: 'id',
      id: RETI_APP_ID,
      params,
    },
    algodClient,
  )
}

export async function getStakingPoolClient(
  poolAppId: number | bigint,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
): Promise<StakingPoolClient> {
  const params = await ParamsCache.getSuggestedParams()

  return new StakingPoolClient(
    {
      sender: { signer, addr: activeAddress } as TransactionSignerAccount,
      resolveBy: 'id',
      id: poolAppId,
      params,
    },
    algodClient,
  )
}

export async function getSimulateStakingPoolClient(
  poolAppId: number | bigint,
  senderAddr: string = FEE_SINK,
  authAddr?: string,
): Promise<StakingPoolClient> {
  const params = await ParamsCache.getSuggestedParams()

  return new StakingPoolClient(
    {
      sender: { addr: senderAddr, signer: makeEmptyTransactionSigner(authAddr) },
      resolveBy: 'id',
      id: poolAppId,
      params,
    },
    algodClient,
  )
}
