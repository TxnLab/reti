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
