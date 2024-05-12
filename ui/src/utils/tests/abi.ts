import { ABIValue } from 'algosdk'
import { StakingPoolSig } from '@/contracts/StakingPoolClient'
import { ValidatorRegistrySig } from '@/contracts/ValidatorRegistryClient'

export interface MethodCallParams {
  method: string
  args?: Record<string, ABIValue>
}

/**
 * Encodes an ABI method call's parameters (name and args) into a Uint8Array.
 * It is used to pass the parameters in the note field of its transaction.
 * In testing, a MSW endpoint handler can parse these parameters to return the correct mock response.
 * @param {string} method - The method name
 * @param {Record<string, ABIValue>} args - The method arguments
 * @returns {Uint8Array} The encoded method call parameters
 * @example
 * encodeCallParams('getPools', { validatorId: 1 })
 */
export function encodeCallParams(
  method: ValidatorRegistrySig | StakingPoolSig,
  args: MethodCallParams['args'],
): Uint8Array {
  const methodName = method.split('(', 1)[0]
  const callParams: MethodCallParams = { method: methodName, ...(args ? { args } : {}) }
  return new Uint8Array(Buffer.from(JSON.stringify(callParams)))
}
