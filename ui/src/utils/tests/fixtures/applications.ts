import { ALGORAND_ZERO_ADDRESS_STRING } from '@/constants/accounts'
import { Application } from '@/interfaces/algod'

interface FixtureData {
  [appId: string]: Application
}

/**
 * Map containing each application's fixture data
 */
export const appFixtures: FixtureData = {
  '1010': {
    // Staking pool appId 1010
    id: 1010,
    params: {
      'approval-program': new Uint8Array([]),
      'clear-state-program': new Uint8Array([]),
      creator: ALGORAND_ZERO_ADDRESS_STRING,
      'global-state': [
        {
          key: Buffer.from('algodVer', 'utf-8').toString('base64'),
          value: {
            type: 1, // Type 1 indicates a string (bytes)
            bytes: Buffer.from('3.23.1 rel/stable [34171a94] : v0.8.2 [c58270f]', 'utf-8').toString(
              'base64',
            ),
            uint: 0,
          },
        },
      ],
    },
  },
}
