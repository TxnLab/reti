import algosdk, { Transaction, TransactionSigner, EncodedSignedTransaction } from 'algosdk'

/**
 * This is a "polyfill" for algosdk's `makeEmptyTransactionSigner` function that supports simulate
 * calls from rekeyed accounts.
 * @see https://github.com/algorand/go-algorand/issues/5914
 *
 * @param {string} authAddr - Optional authorized address (spending key) for a rekeyed account.
 * @returns A function that can be used with simulate w/ the "allow empty signatures" option.
 */
export const makeEmptyTransactionSigner = (authAddr?: string): TransactionSigner => {
  return async (txns: Transaction[], indexesToSign: number[]): Promise<Uint8Array[]> => {
    const emptySigTxns: Uint8Array[] = []

    indexesToSign.forEach((i) => {
      const encodedStxn: EncodedSignedTransaction = {
        txn: txns[i].get_obj_for_encoding(),
      }

      // If authAddr is provided, use its decoded publicKey as the signer
      if (authAddr) {
        const { publicKey } = algosdk.decodeAddress(authAddr)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        encodedStxn.sgnr = publicKey as any as Buffer
      }

      emptySigTxns.push(algosdk.encodeObj(encodedStxn))
    })

    return emptySigTxns
  }
}
