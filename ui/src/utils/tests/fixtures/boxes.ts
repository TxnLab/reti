import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import algosdk from 'algosdk'
import { ALGORAND_ZERO_ADDRESS_STRING } from '@/constants/accounts'
import { StakedInfo } from '@/interfaces/staking'
import { LAST_ROUND } from '@/utils/tests/constants'
import { ACCOUNT_1, ACCOUNT_2 } from '@/utils/tests/fixtures/accounts'
import { createStaticArray } from '@/utils/tests/utils'

export const DEFAULT_STAKED_INFO: StakedInfo = {
  account: ALGORAND_ZERO_ADDRESS_STRING,
  balance: BigInt(0),
  totalRewarded: BigInt(0),
  rewardTokenBalance: BigInt(0),
  entryRound: 0,
}

export const MOCK_STAKED_INFO_1: StakedInfo = {
  account: ACCOUNT_1,
  balance: BigInt(AlgoAmount.Algos(1000).microAlgos),
  totalRewarded: BigInt(AlgoAmount.Algos(10).microAlgos),
  rewardTokenBalance: BigInt(0),
  entryRound: 1,
}

export const MOCK_STAKED_INFO_2: StakedInfo = {
  account: ACCOUNT_2,
  balance: BigInt(AlgoAmount.Algos(2000).microAlgos),
  totalRewarded: BigInt(AlgoAmount.Algos(20).microAlgos),
  rewardTokenBalance: BigInt(0),
  entryRound: 2,
}

interface BoxData {
  name: string
  round: number
  value: string // base64 encoded string
}

interface FixtureData {
  [appId: string]: {
    [boxName: string]: BoxData
  }
}

/**
 * Map containing each application's corresponding box fixture data
 */
export const boxFixtures: FixtureData = {
  '1010': {
    // Staking pool appId 1010
    stakers: {
      name: 'stakers',
      round: LAST_ROUND,
      value: encodeStakersToBase64(
        createStaticArray([MOCK_STAKED_INFO_1, MOCK_STAKED_INFO_2], DEFAULT_STAKED_INFO, 200),
      ),
    },
  },
}

/**
 * Encodes staker information into a base64 string.
 * @param {StakedInfo[]} stakers - Array of staker information.
 * @returns {string} The base64 encoded string of stakers' data.
 */
export function encodeStakersToBase64(stakers: StakedInfo[]): string {
  const bytesPerStaker = 64
  const totalBytes = stakers.length * bytesPerStaker
  const buffer = new Uint8Array(totalBytes)

  stakers.forEach((staker, index) => {
    buffer.set(algosdk.decodeAddress(staker.account).publicKey, index * bytesPerStaker)
    buffer.set(algosdk.bigIntToBytes(staker.balance, 8), index * bytesPerStaker + 32)
    buffer.set(algosdk.bigIntToBytes(staker.totalRewarded, 8), index * bytesPerStaker + 40)
    buffer.set(algosdk.bigIntToBytes(staker.rewardTokenBalance, 8), index * bytesPerStaker + 48)
    buffer.set(algosdk.bigIntToBytes(BigInt(staker.entryRound), 8), index * bytesPerStaker + 56)
  })

  return Buffer.from(buffer).toString('base64')
}
