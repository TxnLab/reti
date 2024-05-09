import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { AssetParams } from '@algorandfoundation/algokit-utils/types/indexer'

export interface AssetHolding {
  amount: number
  'asset-id': number
  'is-frozen': boolean
}

export interface AssetCreatorHolding extends AssetHolding {
  creator: string
}

export interface AccountInformation {
  address: string
  amount: number
  'min-balance': number
  assets?: AssetHolding[]
  'auth-addr'?: string
  'created-assets'?: Asset[]
  // add more fields as needed
}

export type AccountBalance = {
  amount: AlgoAmount
  available: AlgoAmount
  minimum: AlgoAmount
}

export type Exclude =
  | 'all'
  | 'assets'
  | 'created-assets'
  | 'apps-local-state'
  | 'created-apps'
  | 'none'

export interface Asset {
  index: number
  params: AssetParams
}

export interface NodeStatusResponse {
  /**
   * CatchupTime in nanoseconds
   */
  'catchup-time': number | bigint
  /**
   * LastRound indicates the last round seen
   */
  'last-round': number | bigint
  /**
   * LastVersion indicates the last consensus version supported
   */
  'last-version': string
  /**
   * NextVersion of consensus protocol to use
   */
  'next-version': string
  /**
   * NextVersionRound is the round at which the next consensus version will apply
   */
  'next-version-round': number | bigint
  /**
   * NextVersionSupported indicates whether the next consensus version is supported
   * by this node
   */
  'next-version-supported': boolean
  /**
   * StoppedAtUnsupportedRound indicates that the node does not support the new
   * rounds and has stopped making progress
   */
  'stopped-at-unsupported-round': boolean
  /**
   * TimeSinceLastRound in nanoseconds
   */
  'time-since-last-round': number | bigint
  /**
   * The current catchpoint that is being caught up to
   */
  catchpoint?: string
  /**
   * The number of blocks that have already been obtained by the node as part of the
   * catchup
   */
  'catchpoint-acquired-blocks'?: number | bigint
  /**
   * The number of accounts from the current catchpoint that have been processed so
   * far as part of the catchup
   */
  'catchpoint-processed-accounts'?: number | bigint
  /**
   * The number of key-values (KVs) from the current catchpoint that have been
   * processed so far as part of the catchup
   */
  'catchpoint-processed-kvs'?: number | bigint
  /**
   * The total number of accounts included in the current catchpoint
   */
  'catchpoint-total-accounts'?: number | bigint
  /**
   * The total number of blocks that are required to complete the current catchpoint
   * catchup
   */
  'catchpoint-total-blocks'?: number | bigint
  /**
   * The total number of key-values (KVs) included in the current catchpoint
   */
  'catchpoint-total-kvs'?: number | bigint
  /**
   * The number of accounts from the current catchpoint that have been verified so
   * far as part of the catchup
   */
  'catchpoint-verified-accounts'?: number | bigint
  /**
   * The number of key-values (KVs) from the current catchpoint that have been
   * verified so far as part of the catchup
   */
  'catchpoint-verified-kvs'?: number | bigint
  /**
   * The last catchpoint seen by the node
   */
  'last-catchpoint'?: string
  /**
   * Upgrade delay
   */
  'upgrade-delay'?: number | bigint
  /**
   * Next protocol round
   */
  'upgrade-next-protocol-vote-before'?: number | bigint
  /**
   * No votes cast for consensus upgrade
   */
  'upgrade-no-votes'?: number | bigint
  /**
   * This node's upgrade vote
   */
  'upgrade-node-vote'?: boolean
  /**
   * Total voting rounds for current upgrade
   */
  'upgrade-vote-rounds'?: number | bigint
  /**
   * Total votes cast for consensus upgrade
   */
  'upgrade-votes'?: number | bigint
  /**
   * Yes votes required for consensus upgrade
   */
  'upgrade-votes-required'?: number | bigint
  /**
   * Yes votes cast for consensus upgrade
   */
  'upgrade-yes-votes'?: number | bigint
}

/**
 * Encoded block object.
 */
export interface BlockResponse {
  /**
   * Block header data.
   */
  block: BlockHeader
  /**
   * Optional certificate object. This is only included when the format is set to
   * message pack.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cert?: Record<string, any>
}

/**
 * Represents the metadata and state of a block.
 *
 * For more information, refer to: https://github.com/algorand/go-algorand/blob/master/data/bookkeeping/block.go
 */
export interface BlockHeader {
  /**
   * Transaction fees
   */
  fees: string
  /**
   * The number of leftover MicroAlgos after rewards distribution
   */
  frac: number
  /**
   * Genesis ID to which this block belongs
   */
  gen: string
  /**
   * Genesis hash to which this block belongs.
   */
  gh: string
  /**
   * The hash of the previous block
   */
  prev: string
  /**
   * Current protocol
   */
  proto: string
  /**
   * Rewards rate
   */
  rate: number
  /**
   * Round number
   */
  rnd: number
  /**
   * Rewards recalculation round
   */
  rwcalr: number
  /**
   * Rewards pool
   */
  rwd: string
  /**
   * Sortition seed
   */
  seed: string
  /**
   * Timestamp in seconds since epoch
   */
  ts: number
  /**
   * Transaction root SHA512_256
   */
  txn: string
  /**
   * Transaction root SHA256
   */
  txn256: string
  /**
   * StateProofTracking map of type to tracking data
   */
  spt: Map<number, Uint8Array>
}

/**
 * Application index and its parameters
 */
export interface Application {
  /**
   * (appidx) application index.
   */
  id: number | bigint
  /**
   * (appparams) application parameters.
   */
  params: ApplicationParams
}

/**
 * Stores the global information associated with an application.
 */
export interface ApplicationParams {
  /**
   * (approv) approval program.
   */
  'approval-program': Uint8Array
  /**
   * (clearp) approval program.
   */
  'clear-state-program': Uint8Array
  /**
   * The address that created this application. This is the address where the
   * parameters and global state for this application can be found.
   */
  creator: string
  /**
   * (epp) the amount of extra program pages available to this app.
   */
  'extra-program-pages'?: number | bigint
  /**
   * (gs) global state
   */
  'global-state'?: TealKeyValue[]
  /**
   * (gsch) global schema
   */
  'global-state-schema'?: ApplicationStateSchema
  /**
   * (lsch) local schema
   */
  'local-state-schema'?: ApplicationStateSchema
}

/**
 * Represents a key-value pair in an application store.
 */
export interface TealKeyValue {
  key: string
  /**
   * Represents a TEAL value.
   */
  value: TealValue
}

/**
 * Represents a TEAL value.
 */
export interface TealValue {
  /**
   * (tt) value type. Value `1` refers to **bytes**, value `2` refers to **uint**
   */
  type: number | bigint
  /**
   * (tb) bytes value.
   */
  bytes: string
  /**
   * (ui) uint value.
   */
  uint: number | bigint
}

/**
 * Specifies maximums on the number of each type that may be stored.
 */
export interface ApplicationStateSchema {
  /**
   * (nui) num of uints.
   */
  'num-uint': number | bigint
  /**
   * (nbs) num of byte slices.
   */
  'num-byte-slice': number | bigint
}
