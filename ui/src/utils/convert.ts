import { ToStringTypes } from '@/interfaces/utils'

export function convertToStringTypes<T>(obj: T): ToStringTypes<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = {}
  for (const key in obj) {
    const value = obj[key]
    if (Array.isArray(value)) {
      // For arrays and tuples convert each element to a string
      result[key] = value.map(String)
    } else {
      // Convert non-array values to strings
      result[key] = String(value)
    }
  }
  return result as ToStringTypes<T>
}
