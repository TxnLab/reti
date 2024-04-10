import algosdk from 'algosdk'

export function concatUint8Arrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length)
  result.set(a)
  result.set(b, a.length)
  return result
}

/**
 * Encodes a bigint value into an 8-byte big-endian format and pads it to
 * create a 32-byte long Uint8Array.
 * @param {bigint} value - gating value to encode
 * @returns {Uint8Array}
 */
export function gatingValueFromBigint(value: bigint): Uint8Array {
  return concatUint8Arrays(algosdk.encodeUint64(value), new Uint8Array(24))
}
