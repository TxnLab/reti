import { Nfd } from '@/interfaces/nfd'
import { ACCOUNT_3, ACCOUNT_4, ACCOUNT_5 } from '@/utils/tests/fixtures/accounts'

export const MOCK_ROOT_NFD: Nfd = {
  appID: 12345,
  asaID: 67890,
  avatarOutdated: false,
  caAlgo: [ACCOUNT_3, ACCOUNT_4],
  'cache-control': 'max-age=3600',
  category: 'standard',
  currentAsOfBlock: 1000000,
  depositAccount: ACCOUNT_3,
  etag: 'abc123',
  metaTags: ['tag1', 'tag2'],
  name: 'example.algo',
  nfdAccount: ACCOUNT_5,
  owner: ACCOUNT_3,
  properties: {
    internal: { foo: 'bar' },
    userDefined: { foo: 'bar' },
    verified: { foo: 'bar' },
  },
  saleType: 'buyItNow',
  state: 'owned',
  tags: ['tag1', 'tag2'],
  timeChanged: '2024-05-09T12:00:00Z',
  timeCreated: '2024-05-08T12:00:00Z',
  timePurchased: '2024-05-08T12:00:00Z',
}
