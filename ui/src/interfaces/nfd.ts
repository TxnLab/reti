/**
 * NFDProperties contains the expanded metadata stored within an NFD contracts' global-state
 */
export interface NFDProperties {
  /** Internal properties */
  internal?: { [key: string]: string }
  /** User properties */
  userDefined?: { [key: string]: string }
  /** Verified properties */
  verified?: { [key: string]: string }
}

/**
 * NFD contains all known information about an NFD record
 */
export interface Nfd {
  /** NFD Application id */
  appID?: number
  /** NFD ASA id */
  asaID?: number
  /** Whether the verified Avatar set in this NFD is newer (arc19) then is set into the NFD. This will only be present on direct NFD fetch and if true */
  avatarOutdated?: boolean
  /** Verified Algorand addresses for this NFD */
  caAlgo?: string[]
  /** Cache-Control header */
  'cache-control'?: string
  category?: 'curated' | 'premium' | 'standard'
  /** Round this data was last fetched from */
  currentAsOfBlock?: number
  /** account wallets should send funds to - precedence is: caAlgo[0], unverifiedCaAlgo[0], owner */
  depositAccount?: string
  /** ETag */
  etag?: string
  /** Tags set by the system for tracking/analytics */
  metaTags?: string[]
  name: string
  nfdAccount?: string
  /** owner of NFD */
  owner?: string
  /** NFD Application id of Parent if this is a segment */
  parentAppID?: number
  properties?: NFDProperties
  /** Reserved owner of NFD */
  reservedFor?: string
  saleType?: 'auction' | 'buyItNow'
  /** amount NFD is being sold for (microAlgos) */
  sellAmount?: number
  /** RecipientUid of NFD sales */
  seller?: string
  sigNameAddress?: string
  state?: 'available' | 'minting' | 'reserved' | 'forSale' | 'owned'
  /** Tags assigned to this NFD */
  tags?: string[]
  timeChanged?: string
  timeCreated?: string
  timePurchased?: string
  /** Unverified (non-algo) Crypto addresses for this NFD */
  unverifiedCa?: { [key: string]: string[] }
  /** Unverified Algorand addresses for this NFD */
  unverifiedCaAlgo?: string[]
}

export type NfdGetNFDParams = {
  /**
   * View of data to return, tiny, brief (default), or full
   */
  view?: 'tiny' | 'brief' | 'full'
  /**
   * Use if polling waiting for state change - causes notFound to return as 204 instead of 404.  Should only be used when waiting for an NFD to transition from not-existing to being reserved for user to claim
   */
  poll?: boolean
  /**
   * Set to true to return a never-cached result.  Use sparingly and only during certain 'NFD already exists' UX state transitions.
   */
  nocache?: boolean
}
