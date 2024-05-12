import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FixtureFunction = (args: any) => any[]

/**
 * Map containing each ABI method's mock response
 */
export const methodFixtures: Record<string, FixtureFunction> = {
  getPools: ({ validatorId }: { validatorId: number | bigint }) => {
    const pool1 = {
      appId: 1010,
      balance: AlgoAmount.Algos(10_000_000).microAlgos,
    }
    const pool2 = {
      appId: 1020,
      balance: AlgoAmount.Algos(250_000).microAlgos,
    }

    switch (Number(validatorId)) {
      case 1:
        return [[BigInt(pool1.appId), BigInt(validatorId), BigInt(pool1.balance)]]
      case 2:
        return [[BigInt(pool2.appId), BigInt(validatorId), BigInt(pool2.balance)]]
      default:
        return [[0n, 0n, 0n]]
    }
  },
}
