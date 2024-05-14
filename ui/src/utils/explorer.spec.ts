import { ExplorerLink } from '@/utils/explorer'

const mockConfig = {
  accountUrl: 'https://mock-explorer.com/account',
  transactionUrl: 'https://mock-explorer.com/transaction',
  assetUrl: 'https://mock-explorer.com/asset',
  appUrl: 'https://mock-explorer.com/app',
}

vi.mock('@/utils/network/getExplorerConfig', () => ({
  getExplorerConfigFromViteEnvironment: vi.fn(() => mockConfig),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ExplorerLink', () => {
  it('should generate correct account URL using static method', () => {
    const address = 'STATIC_ACCOUNT'
    const expectedUrl = `${mockConfig.accountUrl}/${address}`
    expect(ExplorerLink.account(address)).toBe(expectedUrl)
  })

  it('should generate correct transaction URL using static method', () => {
    const id = 'STATIC_TX'
    const expectedUrl = `${mockConfig.transactionUrl}/${id}`
    expect(ExplorerLink.tx(id)).toBe(expectedUrl)
  })

  it('should generate correct asset URL using static method', () => {
    const id = 12345
    const expectedUrl = `${mockConfig.assetUrl}/${id}`
    expect(ExplorerLink.asset(id)).toBe(expectedUrl)
  })

  it('should generate correct app URL using static method', () => {
    const id = 67890
    const expectedUrl = `${mockConfig.appUrl}/${id}`
    expect(ExplorerLink.app(id)).toBe(expectedUrl)
  })
})
