export interface AssetHolding {
  'asset-id': number
  amount: number
  'is-frozen': boolean
}

export interface AccountInformation {
  address: string
  amount: number
  'min-balance': number
  assets?: AssetHolding[]
  'auth-addr'?: string
  // add more fields as needed
}

export type Exclude =
  | 'all'
  | 'assets'
  | 'created-assets'
  | 'apps-local-state'
  | 'created-apps'
  | 'none'
