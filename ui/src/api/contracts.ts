import * as algokit from '@algorandfoundation/algokit-utils'
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { queryOptions } from '@tanstack/react-query'
import algosdk from 'algosdk'
import { StakingPoolClient } from '@/contracts/StakingPoolClient'
import { ValidatorRegistryClient } from '@/contracts/ValidatorRegistryClient'
import { StakingPoolKey } from '@/interfaces/staking'
import {
  MbrAmounts,
  NodePoolAssignmentConfig,
  RawNodePoolAssignmentConfig,
  Validator,
  ValidatorConfigRaw,
  ValidatorStateRaw,
} from '@/interfaces/validator'
import { transformNodePoolAssignment, transformValidatorData } from '@/utils/contracts'
import { getAlgodConfigFromViteEnvironment } from '@/utils/network/getAlgoClientConfigs'
import {
  getNfdRegistryAppIdFromViteEnvironment,
  getRetiAppIdFromViteEnvironment,
} from '@/utils/env'
import { getActiveWalletAddress } from '@/utils/wallets'

const algodConfig = getAlgodConfigFromViteEnvironment()
const algodClient = algokit.getAlgoClient({
  server: algodConfig.server,
  port: algodConfig.port,
  token: algodConfig.token,
})

const RETI_APP_ID = getRetiAppIdFromViteEnvironment()
const NFD_REGISTRY_APP_ID = getNfdRegistryAppIdFromViteEnvironment()

const makeSimulateValidatorClient = (activeAddress: string) => {
  return new ValidatorRegistryClient(
    {
      sender: { addr: activeAddress, signer: algosdk.makeEmptyTransactionSigner() },
      resolveBy: 'id',
      id: RETI_APP_ID,
      deployTimeParams: {
        NFDRegistryAppID: NFD_REGISTRY_APP_ID,
      },
    },
    algodClient,
  )
}

const makeValidatorClient = (signer: algosdk.TransactionSigner, activeAddress: string) => {
  return new ValidatorRegistryClient(
    {
      sender: { signer, addr: activeAddress } as TransactionSignerAccount,
      resolveBy: 'id',
      id: RETI_APP_ID,
      deployTimeParams: {
        NFDRegistryAppID: NFD_REGISTRY_APP_ID,
      },
    },
    algodClient,
  )
}

const makeStakingPoolClient = (
  appId: number | bigint,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
) => {
  return new StakingPoolClient(
    {
      sender: { signer, addr: activeAddress } as TransactionSignerAccount,
      resolveBy: 'id',
      id: appId,
    },
    algodClient,
  )
}

export function callGetNumValidators(validatorClient: ValidatorRegistryClient) {
  return validatorClient
    .compose()
    .getNumValidators({})
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export function callGetValidatorConfig(
  validatorID: number | bigint,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient
    .compose()
    .getValidatorConfig({ validatorID })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export function callGetValidatorState(
  validatorID: number | bigint,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient
    .compose()
    .getValidatorState({ validatorID })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export async function fetchValidator(
  id: string | number | bigint,
  client?: ValidatorRegistryClient,
) {
  try {
    const activeAddress = getActiveWalletAddress()

    if (!activeAddress) {
      throw new Error('No active wallet found')
    }

    const validatorClient = client || makeSimulateValidatorClient(activeAddress)

    const validatorId = Number(id)

    const [config, state] = await Promise.all([
      callGetValidatorConfig(validatorId, validatorClient),
      callGetValidatorState(validatorId, validatorClient),
    ])

    const rawConfig = config.returns![0] as ValidatorConfigRaw
    const rawState = state.returns![0] as ValidatorStateRaw

    if (!rawConfig || !rawState) {
      throw new ValidatorNotFoundError(`Validator with id "${id}" not found!`)
    }

    // Transform raw data to Validator object
    const validator: Validator = transformValidatorData(rawConfig, rawState)
    return validator
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function fetchValidators(client?: ValidatorRegistryClient) {
  try {
    const activeAddress = getActiveWalletAddress()

    if (!activeAddress) {
      throw new Error('No active wallet found')
    }

    const validatorClient = client || makeSimulateValidatorClient(activeAddress)

    // App call to fetch total number of validators
    const numValidatorsResponse = await callGetNumValidators(validatorClient)

    const numValidators = numValidatorsResponse.returns![0]

    if (!numValidators) {
      throw new Error('No validators found')
    }

    const allValidators: Array<Validator> = []
    const batchSize = 10

    for (let i = 0; i < numValidators; i += batchSize) {
      const batchPromises = Array.from(
        { length: Math.min(batchSize, Number(numValidators) - i) },
        (_, index) => {
          const validatorID = i + index + 1
          return fetchValidator(validatorID, validatorClient)
        },
      )

      // Run batch calls in parallel, then filter out any undefined results
      const batchResults = (await Promise.all(batchPromises)).filter(
        (validator) => validator !== undefined,
      ) as Array<Validator>

      allValidators.push(...batchResults)
    }

    return allValidators
  } catch (error) {
    console.error(error)
    throw error
  }
}

export const validatorsQueryOptions = queryOptions({
  queryKey: ['validators'],
  queryFn: () => fetchValidators(),
})

export const validatorQueryOptions = (validatorId: string) =>
  queryOptions({
    queryKey: ['validator', { validatorId }],
    queryFn: () => fetchValidator(validatorId),
    retry: false,
  })

export class ValidatorNotFoundError extends Error {}

export function callGetNodePoolAssignments(
  validatorID: number | bigint,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient
    .compose()
    .getNodePoolAssignments({ validatorID })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export async function fetchNodePoolAssignments(
  id: string | number | bigint,
): Promise<NodePoolAssignmentConfig> {
  try {
    const activeAddress = getActiveWalletAddress()

    if (!activeAddress) {
      throw new Error('No active wallet found')
    }

    const validatorClient = makeSimulateValidatorClient(activeAddress)

    const validatorId = Number(id)

    const nodePoolAssignmentResponse = await callGetNodePoolAssignments(
      validatorId,
      validatorClient,
    )

    const rawNodePoolAssignmentConfig: RawNodePoolAssignmentConfig | undefined =
      nodePoolAssignmentResponse.returns![0]

    if (!rawNodePoolAssignmentConfig) {
      throw new Error('No node pool assignment found')
    }

    const nodePoolAssignmentConfig = transformNodePoolAssignment(rawNodePoolAssignmentConfig)
    return nodePoolAssignmentConfig
  } catch (error) {
    console.error(error)
    throw error
  }
}

export function callGetMbrAmounts(validatorClient: ValidatorRegistryClient) {
  return validatorClient
    .compose()
    .getMbrAmounts({})
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export async function fetchMbrAmounts(client?: ValidatorRegistryClient): Promise<MbrAmounts> {
  try {
    const activeAddress = getActiveWalletAddress()

    if (!activeAddress) {
      throw new Error('No active wallet found')
    }

    const validatorClient = client || makeSimulateValidatorClient(activeAddress)

    const mbrAmountsResponse = await callGetMbrAmounts(validatorClient)
    const [validatorMbr, poolMbr, poolInitMbr, stakerMbr] = mbrAmountsResponse.returns![0]

    return {
      validatorMbr: Number(validatorMbr),
      poolMbr: Number(poolMbr),
      poolInitMbr: Number(poolInitMbr),
      stakerMbr: Number(stakerMbr),
    }
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function addStakingPool(
  validatorID: number,
  nodeNum: number,
  poolMbr: number,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
): Promise<StakingPoolKey> {
  const validatorClient = makeValidatorClient(signer, activeAddress)

  const validatorAppRef = await validatorClient.appClient.getAppReference()
  const suggestedParams = await algodClient.getTransactionParams().do()

  const payValidatorAddPoolMbr = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: activeAddress,
    to: validatorAppRef.appAddress,
    amount: poolMbr,
    suggestedParams,
  })

  const addPoolResponse = await validatorClient
    .compose()
    .gas({})
    .addPool(
      {
        mbrPayment: {
          transaction: payValidatorAddPoolMbr,
          signer: { signer, addr: activeAddress } as TransactionSignerAccount,
        },
        validatorID,
        nodeNum,
      },
      {
        sendParams: {
          fee: AlgoAmount.MicroAlgos(2000),
        },
      },
    )
    .execute({ populateAppCallResources: true })

  const [valId, poolId, poolAppId] = addPoolResponse.returns![1]

  const stakingPool = {
    id: Number(poolId),
    appId: Number(poolAppId),
    validatorId: Number(valId),
  }

  return stakingPool
}

export async function initStakingPoolStorage(
  appId: number,
  poolInitMbr: number,
  signer: algosdk.TransactionSigner,
  activeAddress: string,
): Promise<void> {
  const suggestedParams = await algodClient.getTransactionParams().do()

  const payPoolInitStorageMbr = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: activeAddress,
    to: algosdk.getApplicationAddress(appId),
    amount: poolInitMbr,
    suggestedParams,
  })

  const stakingPoolClient = makeStakingPoolClient(appId, signer, activeAddress)

  await stakingPoolClient
    .compose()
    .gas({})
    .initStorage({
      mbrPayment: {
        transaction: payPoolInitStorageMbr,
        signer: { signer, addr: activeAddress } as TransactionSignerAccount,
      },
    })
    .execute({ populateAppCallResources: true })
}
