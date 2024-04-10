import { ToStringTypes } from '@/interfaces/utils'

export function convertToStringTypes<T>(obj: T): ToStringTypes<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = {}
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      result[key] = String(obj[key])
    }
  }
  return result
}
