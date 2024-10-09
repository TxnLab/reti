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

export type NfdSearchV2View = (typeof NfdSearchV2View)[keyof typeof NfdSearchV2View]

export const NfdSearchV2View = {
  tiny: 'tiny',
  thumbnail: 'thumbnail',
  brief: 'brief',
  full: 'full',
} as const

export type NfdSearchV2Sort = (typeof NfdSearchV2Sort)[keyof typeof NfdSearchV2Sort]

export const NfdSearchV2Sort = {
  createdDesc: 'createdDesc',
  timeChangedDesc: 'timeChangedDesc',
  soldDesc: 'soldDesc',
  priceAsc: 'priceAsc',
  priceDesc: 'priceDesc',
  highestSaleDesc: 'highestSaleDesc',
  saleTypeAsc: 'saleTypeAsc',
  nameAsc: 'nameAsc',
} as const

export type NfdSearchV2Vproperty = (typeof NfdSearchV2Vproperty)[keyof typeof NfdSearchV2Vproperty]

export const NfdSearchV2Vproperty = {
  discord: 'discord',
  telegram: 'telegram',
  twitter: 'twitter',
  github: 'github',
  email: 'email',
  domain: 'domain',
  nostrpubkey: 'nostrpubkey',
} as const

export type NfdSearchV2TraitsItem =
  (typeof NfdSearchV2TraitsItem)[keyof typeof NfdSearchV2TraitsItem]

export const NfdSearchV2TraitsItem = {
  emoji: 'emoji',
  pristine: 'pristine',
  segment: 'segment',
} as const

export type NfdSearchV2LengthItem =
  (typeof NfdSearchV2LengthItem)[keyof typeof NfdSearchV2LengthItem]

export const NfdSearchV2LengthItem = {
  '1_letters': '1_letters',
  '2_letters': '2_letters',
  '3_letters': '3_letters',
  '4_letters': '4_letters',
  '5_letters': '5_letters',
  '6_letters': '6_letters',
  '7_letters': '7_letters',
  '8_letters': '8_letters',
  '9_letters': '9_letters',
  '10+_letters': '10+_letters',
} as const

/**
 * State of NFD
 */
export type NfdSearchV2StateItem = (typeof NfdSearchV2StateItem)[keyof typeof NfdSearchV2StateItem]

export const NfdSearchV2StateItem = {
  reserved: 'reserved',
  forSale: 'forSale',
  owned: 'owned',
} as const

/**
 * Sale type of NFD
 */
export type NfdSearchV2SaleTypeItem =
  (typeof NfdSearchV2SaleTypeItem)[keyof typeof NfdSearchV2SaleTypeItem]

export const NfdSearchV2SaleTypeItem = {
  auction: 'auction',
  buyItNow: 'buyItNow',
} as const

/**
 * Category of NFD
 */
export type NfdSearchV2CategoryItem =
  (typeof NfdSearchV2CategoryItem)[keyof typeof NfdSearchV2CategoryItem]

export const NfdSearchV2CategoryItem = {
  curated: 'curated',
  premium: 'premium',
  common: 'common',
} as const

export type NfdSearchV2Params = {
  /**
   * name or partial match of NFD name to filter on
   */
  name?: string
  category?: NfdSearchV2CategoryItem[]
  saleType?: NfdSearchV2SaleTypeItem[]
  state?: NfdSearchV2StateItem[]
  /**
   * The parent NFD Application ID to find. Used for fetching segments of an NFD
   */
  parentAppID?: bigint | number
  /**
   * Length of NFD
   */
  length?: NfdSearchV2LengthItem[]
  /**
   * Traits of NFD
   */
  traits?: NfdSearchV2TraitsItem[]
  /**
   * An Algorand account address to find all NFDs owned by that address
   */
  owner?: string
  /**
   * An Algorand account address to find all NFDs reserved for that address
   */
  reservedFor?: string
  /**
   * Should NFDs reserved for an account (transfers for example or unclaimed winning auctions) be excluded
   */
  excludeUserReserved?: boolean
  /**
   * The start of an NFD name, fetching multiple NFDs that have that prefix
   */
  prefix?: string
  /**
   * Part of an NFD name, fetching multiple NFDs that have that substring (minimum 3 characters)
   */
  substring?: string
  /**
   * Verified property name to search on - specify value with vvalue
   */
  vproperty?: NfdSearchV2Vproperty
  /**
   * Value to find in the vproperty field specified with the vproperty parameter
   */
  vvalue?: string
  /**
   * Whether to explicitly filter on segments being locked or unlocked.  Typically only valuable when filtering on unlocked
   */
  segmentLocked?: boolean
  /**
   * Whether to explicitly filter on NFD roots or segments.  True to only see roots, False to only see segments.
   */
  segmentRoot?: boolean
  /**
   * Minimum price of NFD
   */
  minPrice?: number
  /**
   * Maximum price of NFD
   */
  maxPrice?: number
  /**
   * Minimum price of NFD Segment in USD (cents)
   */
  minPriceUsd?: number
  /**
   * Maximum price of NFD Segment in USD (cents)
   */
  maxPriceUsd?: number
  /**
   * Fetch NFDs that changed after the specified timestamp
   */
  changedAfter?: string
  /**
   * Limit the number of results returned - max 200
   */
  limit?: number
  /**
   * Starting document in large list.  Fetch 1-100 [limit 100], pass offset 100 to fetch 100-200
   */
  offset?: number
  /**
   * What to sort on
   */
  sort?: NfdSearchV2Sort
  /**
   * View of data to return, tiny (name, owner, caAlgo, unverifiedCaAlgo only), brief (default), or full
   */
  view?: NfdSearchV2View
}

export interface NfdV2SearchRecords {
  nfds: Nfd[]
  /** total number of results, with data containing paged amount based on offset/limit */
  total: number
}

export type NfdGetLookupView = (typeof NfdGetLookupView)[keyof typeof NfdGetLookupView]

export const NfdGetLookupView = {
  tiny: 'tiny',
  thumbnail: 'thumbnail',
  brief: 'brief',
  full: 'full',
} as const

export type NfdGetLookupParams = {
  /**
   * one or more addresses (algo or otherwise) to look up, maximum of 20 can be defined.  Specify the same query parameter multiple times for each address, ie: address=xxx&address=yyy&address=zzz
   */
  address: string[]
  /**
   * View of data to return, tiny (name, owner, caAlgo, unverifiedCaAlgo only [default]), thumbnail (tiny + avatar), brief, or full
   */
  view?: NfdGetLookupView
  /**
   * Whether to allow unverified addresses to match (and only if its only match).  Defaults to false
   */
  allowUnverified?: boolean
}

export type NfdGetLookup200 = { [key: string]: Nfd }
