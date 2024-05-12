import { ToStringTypes } from '@/interfaces/utils'
import { convertToStringTypes } from '@/utils/convert'

describe('convertToStringTypes', () => {
  it('should convert an object with primitive values to strings', () => {
    const input = {
      number: 123,
      boolean: true,
      string: 'hello',
    }
    const expected: ToStringTypes<typeof input> = {
      number: '123',
      boolean: 'true',
      string: 'hello',
    }
    const result = convertToStringTypes(input)
    expect(result).toEqual(expected)
  })

  it('should convert an object with arrays of primitive values to strings', () => {
    const input = {
      numbers: [1, 2, 3],
      booleans: [true, false, true],
      strings: ['apple', 'banana'],
    }
    const expected: ToStringTypes<typeof input> = {
      numbers: ['1', '2', '3'],
      booleans: ['true', 'false', 'true'],
      strings: ['apple', 'banana'],
    }
    const result = convertToStringTypes(input)
    expect(result).toEqual(expected)
  })

  it('should handle empty objects and arrays', () => {
    const input = {
      emptyArray: [],
      emptyObject: {},
    }
    const expected: ToStringTypes<typeof input> = {
      emptyArray: [],
      emptyObject: '{}',
    }
    const result = convertToStringTypes(input)
    expect(result).toEqual(expected)
  })

  it('should convert nested arrays to strings', () => {
    const input = {
      nestedArray: [
        [1, 2],
        [3, 4],
      ],
    }
    const expected: ToStringTypes<typeof input> = {
      nestedArray: [
        ['1', '2'],
        ['3', '4'],
      ],
    }
    const result = convertToStringTypes(input)
    expect(result).toEqual(expected)
  })
})
