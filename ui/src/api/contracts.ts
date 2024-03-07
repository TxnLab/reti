import * as algokit from '@algorandfoundation/algokit-utils'
import { queryOptions } from '@tanstack/react-query'
import algosdk from 'algosdk'
import { ValidatorRegistryClient } from '@/contracts/ValidatorRegistryClient'
import { Validator, ValidatorConfigRaw, ValidatorStateRaw } from '@/interfaces/validator'
import { transformValidatorData } from '@/utils/contracts'
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

export function getNumValidators(validatorClient: ValidatorRegistryClient) {
  return validatorClient
    .compose()
    .getNumValidators({})
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export function getValidatorConfig(
  validatorID: number | bigint,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient
    .compose()
    .getValidatorConfig({ validatorID })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export function getValidatorState(
  validatorID: number | bigint,
  validatorClient: ValidatorRegistryClient,
) {
  return validatorClient
    .compose()
    .getValidatorState({ validatorID })
    .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })
}

export async function fetchValidator(id: number | bigint, client?: ValidatorRegistryClient) {
  try {
    const activeAddress = getActiveWalletAddress()

    if (!activeAddress) {
      throw new Error('No active wallet found')
    }

    const validatorClient = client || makeSimulateValidatorClient(activeAddress)

    const [config, state] = await Promise.all([
      getValidatorConfig(id, validatorClient),
      getValidatorState(id, validatorClient),
    ])

    const rawConfig = config.returns![0] as ValidatorConfigRaw
    const rawState = state.returns![0] as ValidatorStateRaw

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
    const numValidatorsResponse = await getNumValidators(validatorClient)

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

export const validatorQueryOptions = (validatorId: number | bigint) =>
  queryOptions({
    queryKey: ['validator', { validatorId }],
    queryFn: () => fetchValidator(validatorId),
  })
