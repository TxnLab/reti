import algosdk from 'algosdk'
import {
  concatUint8Arrays,
  gatingValueFromBigint,
  decodeUint8ArrayToBigint,
  chunkBytes,
} from '@/utils/bytes'

describe('concatUint8Arrays', () => {
  it('should concatenate two Uint8Arrays', () => {
    const a = new Uint8Array([1, 2, 3])
    const b = new Uint8Array([4, 5, 6])
    const result = concatUint8Arrays(a, b)
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]))
  })
})

describe('gatingValueFromBigint', () => {
  it('should encode a bigint to a 32-byte long Uint8Array', () => {
    const value = BigInt(123456789)
    const result = gatingValueFromBigint(value)
    const encodedValue = algosdk.encodeUint64(value)
    const expected = new Uint8Array([...encodedValue, ...new Uint8Array(24)])
    expect(result).toEqual(expected)
  })
})

describe('decodeUint8ArrayToBigint', () => {
  it('should decode a Uint8Array to a bigint', () => {
    const value = BigInt(987654321)
    const encodedValue = algosdk.encodeUint64(value)
    const paddedValue = new Uint8Array([...encodedValue, ...new Uint8Array(24)])
    const result = decodeUint8ArrayToBigint(paddedValue)
    expect(result).toBe(value)
  })

  it('should throw an error if the data is shorter than 8 bytes', () => {
    const invalidData = new Uint8Array([1, 2, 3, 4, 5, 6, 7])
    expect(() => decodeUint8ArrayToBigint(invalidData)).toThrow(
      'Data is too short to contain a valid encoded bigint.',
    )
  })
})

describe('chunkBytes', () => {
  it('should split a Uint8Array into chunks of a given size', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const result = chunkBytes(data, 4)
    expect(result).toEqual([
      new Uint8Array([1, 2, 3, 4]),
      new Uint8Array([5, 6, 7, 8]),
      new Uint8Array([9, 10]),
    ])
  })

  it('should return an empty array when given an empty Uint8Array', () => {
    const data = new Uint8Array([])
    const result = chunkBytes(data, 4)
    expect(result).toEqual([])
  })
})
