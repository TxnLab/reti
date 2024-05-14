import * as algokit from '@algorandfoundation/algokit-utils'
import algosdk from 'algosdk'
import { ParamsCache } from '@/utils/paramsCache'

const mockParams: algosdk.SuggestedParams = {
  fee: 1000,
  firstRound: 1000,
  lastRound: 2000,
  genesisID: 'dockernet-v1',
  genesisHash: 'v1lkQZYrxQn1XDRkIAlsUrSSECXU6OFMbPMhj/QQ9dk=',
}

// Mock getTransactionParams
const mockGetTransactionParams = vi.fn().mockResolvedValue(mockParams)

// Mock algokit-utils
vi.mock('@algorandfoundation/algokit-utils', () => ({
  getAlgoClient: vi.fn(() => ({
    getTransactionParams: vi.fn(() => ({
      do: mockGetTransactionParams,
    })),
  })),
}))

// Mock getAlgodConfigFromViteEnvironment
vi.mock('@/utils/network/getAlgoClientConfigs', () => ({
  getAlgodConfigFromViteEnvironment: () => ({
    server: 'http://localhost',
    port: '4001',
    token: '',
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  ParamsCache.resetInstance() // Reset singleton instance
})

describe('ParamsCache', () => {
  it('should fetch and cache transaction parameters', async () => {
    const params = await ParamsCache.getSuggestedParams()
    expect(algokit.getAlgoClient).toHaveBeenCalledTimes(1) // First call
    expect(params).toEqual(mockParams)

    // Simulate another call within 5 minutes
    const cachedParams = await ParamsCache.getSuggestedParams()
    expect(algokit.getAlgoClient).toHaveBeenCalledTimes(1) // No second call (cached)
    expect(cachedParams).toEqual(params)
  })

  it('should refresh cached parameters after expiration', async () => {
    const initialParams = await ParamsCache.getSuggestedParams()
    expect(algokit.getAlgoClient).toHaveBeenCalledTimes(1) // First call
    expect(initialParams).toEqual(mockParams)

    // Mock Date.now to simulate cache expiration (5 minutes later)
    const originalNow = Date.now
    global.Date.now = () => originalNow() + 1000 * 60 * 6 // +6 minutes

    // Simulate another call after expiration
    const refreshedParams = await ParamsCache.getSuggestedParams()
    expect(mockGetTransactionParams).toHaveBeenCalledTimes(2) // Second call
    expect(refreshedParams).toEqual(initialParams)

    // Restore Date.now
    global.Date.now = originalNow
  })
})
