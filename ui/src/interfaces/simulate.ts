import { EncodedSignedTransaction } from 'algosdk'

/**
 * Request type for simulation endpoint.
 */
export interface SimulateRequest {
  /**
   * The transaction groups to simulate.
   */
  'txn-groups': SimulateRequestTransactionGroup[]
  /**
   * Allows transactions without signatures to be simulated as if they had correct
   * signatures.
   */
  'allow-empty-signatures'?: boolean
  /**
   * Lifts limits on log opcode usage during simulation.
   */
  'allow-more-logging'?: boolean
  /**
   * Allows access to unnamed resources during simulation.
   */
  'allow-unnamed-resources'?: boolean
  /**
   * An object that configures simulation execution trace.
   */
  'exec-trace-config'?: SimulateTraceConfig
  /**
   * Applies extra opcode budget during simulation for each transaction group.
   */
  'extra-opcode-budget'?: number | bigint
  /**
   * If provided, specifies the round preceding the simulation. State changes through
   * this round will be used to run this simulation. Usually only the 4 most recent
   * rounds will be available (controlled by the node config value MaxAcctLookback).
   * If not specified, defaults to the latest available round.
   */
  round?: number | bigint
}

/**
 * A transaction group to simulate.
 */
export interface SimulateRequestTransactionGroup {
  /**
   * An atomic transaction group.
   */
  txns: EncodedSignedTransaction[]
}

/**
 * Result of a transaction group simulation.
 */
export interface SimulateResponse {
  /**
   * The round immediately preceding this simulation. State changes through this
   * round were used to run this simulation.
   */
  'last-round': number | bigint
  /**
   * A result object for each transaction group that was simulated.
   */
  'txn-groups': SimulateTransactionGroupResult[]
  /**
   * The version of this response object.
   */
  version: number | bigint
  /**
   * The set of parameters and limits override during simulation. If this set of
   * parameters is present, then evaluation parameters may differ from standard
   * evaluation in certain ways.
   */
  'eval-overrides'?: SimulationEvalOverrides
  /**
   * An object that configures simulation execution trace.
   */
  'exec-trace-config'?: SimulateTraceConfig
  /**
   * Initial states of resources that were accessed during simulation.
   */
  'initial-states'?: SimulateInitialStates
}

/**
 * Simulation result for an atomic transaction group
 */
export interface SimulateTransactionGroupResult {
  /**
   * Simulation result for individual transactions
   */
  'txn-results': SimulateTransactionResult[]
  /**
   * Total budget added during execution of app calls in the transaction group.
   */
  'app-budget-added'?: number | bigint
  /**
   * Total budget consumed during execution of app calls in the transaction group.
   */
  'app-budget-consumed'?: number | bigint
  /**
   * If present, indicates which transaction in this group caused the failure. This
   * array represents the path to the failing transaction. Indexes are zero based,
   * the first element indicates the top-level transaction, and successive elements
   * indicate deeper inner transactions.
   */
  'failed-at'?: (number | bigint)[]
  /**
   * If present, indicates that the transaction group failed and specifies why that
   * happened
   */
  'failure-message'?: string
  /**
   * These are resources that were accessed by this group that would normally have
   * caused failure, but were allowed in simulation. Depending on where this object
   * is in the response, the unnamed resources it contains may or may not qualify for
   * group resource sharing. If this is a field in SimulateTransactionGroupResult,
   * the resources do qualify, but if this is a field in SimulateTransactionResult,
   * they do not qualify. In order to make this group valid for actual submission,
   * resources that qualify for group sharing can be made available by any
   * transaction of the group; otherwise, resources must be placed in the same
   * transaction which accessed them.
   */
  'unnamed-resources-accessed'?: SimulateUnnamedResourcesAccessed
}

/**
 * Simulation result for an atomic transaction group
 */
export interface SimulateTransactionResult {
  /**
   * Details about a pending transaction. If the transaction was recently confirmed,
   * includes confirmation details like the round and reward details.
   */
  'txn-result': PendingTransactionResponse
  /**
   * Budget used during execution of an app call transaction. This value includes
   * budged used by inner app calls spawned by this transaction.
   */
  'app-budget-consumed'?: number | bigint
  /**
   * The execution trace of calling an app or a logic sig, containing the inner app
   * call trace in a recursive way.
   */
  'exec-trace'?: SimulationTransactionExecTrace
  /**
   * Budget used during execution of a logic sig transaction.
   */
  'logic-sig-budget-consumed'?: number | bigint
  /**
   * These are resources that were accessed by this group that would normally have
   * caused failure, but were allowed in simulation. Depending on where this object
   * is in the response, the unnamed resources it contains may or may not qualify for
   * group resource sharing. If this is a field in SimulateTransactionGroupResult,
   * the resources do qualify, but if this is a field in SimulateTransactionResult,
   * they do not qualify. In order to make this group valid for actual submission,
   * resources that qualify for group sharing can be made available by any
   * transaction of the group; otherwise, resources must be placed in the same
   * transaction which accessed them.
   */
  'unnamed-resources-accessed'?: SimulateUnnamedResourcesAccessed
}

/**
 * Details about a pending transaction. If the transaction was recently confirmed,
 * includes confirmation details like the round and reward details.
 */
export interface PendingTransactionResponse {
  /**
   * Indicates that the transaction was kicked out of this node's transaction pool
   * (and specifies why that happened). An empty string indicates the transaction
   * wasn't kicked out of this node's txpool due to an error.
   */
  'pool-error': string
  /**
   * The raw signed transaction.
   */
  txn: EncodedSignedTransaction
  /**
   * The application index if the transaction was found and it created an
   * application.
   */
  'application-index'?: number | bigint
  /**
   * The number of the asset's unit that were transferred to the close-to address.
   */
  'asset-closing-amount'?: number | bigint
  /**
   * The asset index if the transaction was found and it created an asset.
   */
  'asset-index'?: number | bigint
  /**
   * Rewards in microalgos applied to the close remainder to account.
   */
  'close-rewards'?: number | bigint
  /**
   * Closing amount for the transaction.
   */
  'closing-amount'?: number | bigint
  /**
   * The round where this transaction was confirmed, if present.
   */
  'confirmed-round'?: number | bigint
  /**
   * Global state key/value changes for the application being executed by this
   * transaction.
   */
  'global-state-delta'?: EvalDeltaKeyValue[]
  /**
   * Inner transactions produced by application execution.
   */
  'inner-txns'?: PendingTransactionResponse[]
  /**
   * Local state key/value changes for the application being executed by this
   * transaction.
   */
  'local-state-delta'?: AccountStateDelta[]
  /**
   * Logs for the application being executed by this transaction.
   */
  logs?: Uint8Array[]
  /**
   * Rewards in microalgos applied to the receiver account.
   */
  'receiver-rewards'?: number | bigint
  /**
   * Rewards in microalgos applied to the sender account.
   */
  'sender-rewards'?: number | bigint
}

/**
 * The execution trace of calling an app or a logic sig, containing the inner app
 * call trace in a recursive way.
 */
export interface SimulationTransactionExecTrace {
  /**
   * SHA512_256 hash digest of the approval program executed in transaction.
   */
  'approval-program-hash'?: Uint8Array
  /**
   * Program trace that contains a trace of opcode effects in an approval program.
   */
  'approval-program-trace'?: SimulationOpcodeTraceUnit[]
  /**
   * SHA512_256 hash digest of the clear state program executed in transaction.
   */
  'clear-state-program-hash'?: Uint8Array
  /**
   * Program trace that contains a trace of opcode effects in a clear state program.
   */
  'clear-state-program-trace'?: SimulationOpcodeTraceUnit[]
  /**
   * An array of SimulationTransactionExecTrace representing the execution trace of
   * any inner transactions executed.
   */
  'inner-trace'?: SimulationTransactionExecTrace[]
  /**
   * SHA512_256 hash digest of the logic sig executed in transaction.
   */
  'logic-sig-hash'?: Uint8Array
  /**
   * Program trace that contains a trace of opcode effects in a logic sig.
   */
  'logic-sig-trace'?: SimulationOpcodeTraceUnit[]
}

/**
 * These are resources that were accessed by this group that would normally have
 * caused failure, but were allowed in simulation. Depending on where this object
 * is in the response, the unnamed resources it contains may or may not qualify for
 * group resource sharing. If this is a field in SimulateTransactionGroupResult,
 * the resources do qualify, but if this is a field in SimulateTransactionResult,
 * they do not qualify. In order to make this group valid for actual submission,
 * resources that qualify for group sharing can be made available by any
 * transaction of the group; otherwise, resources must be placed in the same
 * transaction which accessed them.
 */
export interface SimulateUnnamedResourcesAccessed {
  /**
   * The unnamed accounts that were referenced. The order of this array is arbitrary.
   */
  accounts?: string[]
  /**
   * The unnamed application local states that were referenced. The order of this
   * array is arbitrary.
   */
  'app-locals'?: ApplicationLocalReference[]
  /**
   * The unnamed applications that were referenced. The order of this array is
   * arbitrary.
   */
  apps?: (number | bigint)[]
  /**
   * The unnamed asset holdings that were referenced. The order of this array is
   * arbitrary.
   */
  'asset-holdings'?: AssetHoldingReference[]
  /**
   * The unnamed assets that were referenced. The order of this array is arbitrary.
   */
  assets?: (number | bigint)[]
  /**
   * The unnamed boxes that were referenced. The order of this array is arbitrary.
   */
  boxes?: BoxReference[]
  /**
   * The number of extra box references used to increase the IO budget. This is in
   * addition to the references defined in the input transaction group and any
   * referenced to unnamed boxes.
   */
  'extra-box-refs'?: number | bigint
}

/**
 * Key-value pairs for StateDelta.
 */
export interface EvalDeltaKeyValue {
  key: string
  /**
   * Represents a TEAL value delta.
   */
  value: EvalDelta
}

/**
 * Represents a TEAL value delta.
 */
export interface EvalDelta {
  /**
   * (at) delta action.
   */
  action: number | bigint
  /**
   * (bs) bytes value.
   */
  bytes?: string
  /**
   * (ui) uint value.
   */
  uint?: number | bigint
}

/**
 * Application state delta.
 */
export interface AccountStateDelta {
  address: string
  /**
   * Application state delta.
   */
  delta: EvalDeltaKeyValue[]
}

/**
 * The set of trace information and effect from evaluating a single opcode.
 */
export interface SimulationOpcodeTraceUnit {
  /**
   * The program counter of the current opcode being evaluated.
   */
  pc: number | bigint
  /**
   * The writes into scratch slots.
   */
  'scratch-changes'?: ScratchChange[]
  /**
   * The indexes of the traces for inner transactions spawned by this opcode, if any.
   */
  'spawned-inners'?: (number | bigint)[]
  /**
   * The values added by this opcode to the stack.
   */
  'stack-additions'?: AvmValue[]
  /**
   * The number of deleted stack values by this opcode.
   */
  'stack-pop-count'?: number | bigint
  /**
   * The operations against the current application's states.
   */
  'state-changes'?: ApplicationStateOperation[]
}

/**
 * A write operation into a scratch slot.
 */
export interface ScratchChange {
  /**
   * Represents an AVM value.
   */
  'new-value': AvmValue
  /**
   * The scratch slot written.
   */
  slot: number | bigint
}

/**
 * An operation against an application's global/local/box state.
 */
export interface ApplicationStateOperation {
  /**
   * Type of application state. Value `g` is **global state**, `l` is **local
   * state**, `b` is **boxes**.
   */
  'app-state-type': string
  /**
   * The key (name) of the global/local/box state.
   */
  key: Uint8Array
  /**
   * Operation type. Value `w` is **write**, `d` is **delete**.
   */
  operation: string
  /**
   * For local state changes, the address of the account associated with the local
   * state.
   */
  account?: string
  /**
   * Represents an AVM value.
   */
  'new-value'?: AvmValue
}

/**
 * Represents an AVM value.
 */
export interface AvmValue {
  /**
   * value type. Value `1` refers to **bytes**, value `2` refers to **uint64**
   */
  type: number | bigint
  /**
   * bytes value.
   */
  bytes?: Uint8Array
  /**
   * uint value.
   */
  uint?: number | bigint
}

/**
 * Represents an AVM key-value pair in an application store.
 */
export interface AvmKeyValue {
  key: Uint8Array
  /**
   * Represents an AVM value.
   */
  value: AvmValue
}

/**
 * References an account's local state for an application.
 */
export interface ApplicationLocalReference {
  /**
   * Address of the account with the local state.
   */
  account: string
  /**
   * Application ID of the local state application.
   */
  app: number | bigint
}

/**
 * References an asset held by an account.
 */
export interface AssetHoldingReference {
  /**
   * Address of the account holding the asset.
   */
  account: string
  /**
   * Asset ID of the holding.
   */
  asset: number | bigint
}

/**
 * References a box of an application.
 */
export interface BoxReference {
  /**
   * Application ID which this box belongs to
   */
  app: number | bigint
  /**
   * Base64 encoded box name
   */
  name: Uint8Array
}

/**
 * The set of parameters and limits override during simulation. If this set of
 * parameters is present, then evaluation parameters may differ from standard
 * evaluation in certain ways.
 */
export interface SimulationEvalOverrides {
  /**
   * If true, transactions without signatures are allowed and simulated as if they
   * were properly signed.
   */
  'allow-empty-signatures'?: boolean
  /**
   * If true, allows access to unnamed resources during simulation.
   */
  'allow-unnamed-resources'?: boolean
  /**
   * The extra opcode budget added to each transaction group during simulation
   */
  'extra-opcode-budget'?: number | bigint
  /**
   * The maximum log calls one can make during simulation
   */
  'max-log-calls'?: number | bigint
  /**
   * The maximum byte number to log during simulation
   */
  'max-log-size'?: number | bigint
}

export interface SimulateTraceConfig {
  /**
   * A boolean option for opting in execution trace features simulation endpoint.
   */
  enable?: boolean
  /**
   * A boolean option enabling returning scratch slot changes together with execution
   * trace during simulation.
   */
  'scratch-change'?: boolean
  /**
   * A boolean option enabling returning stack changes together with execution trace
   * during simulation.
   */
  'stack-change'?: boolean
  /**
   * A boolean option enabling returning application state changes (global, local,
   * and box changes) with the execution trace during simulation.
   */
  'state-change'?: boolean
}

/**
 * Initial states of resources that were accessed during simulation.
 */
export interface SimulateInitialStates {
  /**
   * The initial states of accessed application before simulation. The order of this
   * array is arbitrary.
   */
  'app-initial-states'?: ApplicationInitialStates[]
}

/**
 * An application's initial global/local/box states that were accessed during
 * simulation.
 */
export interface ApplicationInitialStates {
  /**
   * Application index.
   */
  id: number | bigint
  /**
   * An application's global/local/box state.
   */
  'app-boxes'?: ApplicationKVStorage
  /**
   * An application's global/local/box state.
   */
  'app-globals'?: ApplicationKVStorage
  /**
   * An application's initial local states tied to different accounts.
   */
  'app-locals'?: ApplicationKVStorage[]
}

/**
 * An application's global/local/box state.
 */
export interface ApplicationKVStorage {
  /**
   * Key-Value pairs representing application states.
   */
  kvs: AvmKeyValue[]
  /**
   * The address of the account associated with the local state.
   */
  account?: string
}
