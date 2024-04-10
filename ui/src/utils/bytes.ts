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
 * @param {bigint} value - The gating value to encode
 * @returns {Uint8Array} - The encoded gating value
 */
export function gatingValueFromBigint(value: bigint): Uint8Array {
  return concatUint8Arrays(algosdk.encodeUint64(value), new Uint8Array(24))
}

/**
 * Decodes a Uint8Array back into a bigint.
 * Assumes the Uint8Array was encoded in an 8-byte big-endian format,
 * followed by padding, similar to how `gatingValueFromBigint` encodes it.
 * @param {Uint8Array} data - The Uint8Array to decode, expected to be 32 bytes long.
 * @returns {bigint} - The decoded bigint value.
 */
export function decodeUint8ArrayToBigint(data: Uint8Array): bigint {
  if (data.length < 8) {
    throw new Error('Data is too short to contain a valid encoded bigint.')
  }

  // Extract the first 8 bytes that contain the big-endian encoded bigint
  let result: bigint = BigInt(0)
  for (let i = 0; i < 8; i++) {
    // Shift the result left by 8 bits to make room for the next byte
    result = (result << BigInt(8)) + BigInt(data[i])
  }

  return result
}
