import { ABITupleType, ABIValue } from 'algosdk'
import { StakingPoolSig } from '@/contracts/StakingPoolClient'
import { ValidatorRegistrySig } from '@/contracts/ValidatorRegistryClient'

export interface MethodCallParams {
  method: string
  args?: Record<string, ABIValue>
}

export function encodeCallParams(
  method: ValidatorRegistrySig | StakingPoolSig,
  args: MethodCallParams['args'],
): Uint8Array {
  const methodName = method.split('(', 1)[0]
  const callParams: MethodCallParams = { method: methodName, ...(args ? { args } : {}) }
  return new Uint8Array(Buffer.from(JSON.stringify(callParams)))
}

export function parseMethodSignature(signature: string): {
  name: string
  args: string[]
  returns: string
} {
  const argsStart = signature.indexOf('(')
  if (argsStart === -1) {
    throw new Error(`Invalid method signature: ${signature}`)
  }

  let argsEnd = -1
  let depth = 0
  for (let i = argsStart; i < signature.length; i++) {
    const char = signature[i]

    if (char === '(') {
      depth += 1
    } else if (char === ')') {
      if (depth === 0) {
        // unpaired parenthesis
        break
      }

      depth -= 1
      if (depth === 0) {
        argsEnd = i
        break
      }
    }
  }

  if (argsEnd === -1) {
    throw new Error(`Invalid method signature: ${signature}`)
  }

  return {
    name: signature.slice(0, argsStart),
    args: ABITupleType.parseTupleContent(signature.slice(argsStart + 1, argsEnd)),
    returns: signature.slice(argsEnd + 1),
  }
}
