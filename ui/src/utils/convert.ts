import { ToStringTypes } from '@/interfaces/utils'

/**
 * Converts all values in an object to strings.
 * Handles nested objects and arrays.
 * @template T - The type of the object to convert
 * @param {T} obj - The object to convert
 * @returns {ToStringTypes<T>} The object with all values converted to strings
 * @example
 * const input = {
 *   number: 123,
 *   boolean: true,
 *   string: 'hello',
 *   array: [1, 2, 3],
 * }
 * const result = convertToStringTypes(input)
 * // result = {
 * //   number: '123',
 * //   boolean: 'true',
 * //   string: 'hello',
 * //   array: ['1', '2', '3'],
 * // }
 */
export function convertToStringTypes<T>(obj: T): ToStringTypes<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = {}

  for (const key in obj) {
    const value = obj[key]

    if (Array.isArray(value)) {
      // Handle arrays
      result[key] = value.map((element) => {
        if (Array.isArray(element)) {
          // Maintain nested array structure
          return element.map((subElement) => String(subElement))
        } else if (typeof element === 'object' && element !== null) {
          // Recursively convert non-array objects
          return convertToStringTypes(element)
        }
        return String(element)
      })
    } else if (typeof value === 'object' && value !== null) {
      // Recursively convert non-array objects
      result[key] = Object.keys(value).length === 0 ? '{}' : convertToStringTypes(value)
    } else {
      result[key] = String(value)
    }
  }

  return result as ToStringTypes<T>
}
