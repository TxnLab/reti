import * as React from 'react'

export const LOCAL_STORAGE_PREFIX = 'reti/'

export interface VersionedStorageConfig<T> {
  version: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  migrate?: (persistedState: any, version: number) => T
}

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  config?: VersionedStorageConfig<T>,
): [T, (value: T) => void] {
  // Initialize the state with the value from local storage or the provided initial value
  const [storedValue, setStoredValue] = React.useState<T>(() => {
    try {
      const item = window.localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${key}`)
      if (item) {
        const parsedItem = JSON.parse(item)
        const storedVersion = parsedItem.version || 0
        let data = parsedItem.value

        // Version mismatch
        if (config && storedVersion !== config.version) {
          // Perform migration if migrate function is provided
          data = config.migrate?.(data, storedVersion) || initialValue
        }

        return data
      }
      return initialValue
    } catch (error) {
      console.error(`Failed to read "${key}" from local storage:`, error)
      return initialValue
    }
  })

  const setValue = (valueOrUpdater: T | ((prevValue: T) => T)) => {
    try {
      const valueToStore =
        valueOrUpdater instanceof Function ? valueOrUpdater(storedValue) : valueOrUpdater
      setStoredValue(valueToStore)
      // Save to local storage with version
      window.localStorage.setItem(
        `${LOCAL_STORAGE_PREFIX}${key}`,
        JSON.stringify({ version: config?.version || 0, value: valueToStore }),
      )
    } catch (error) {
      console.error(`Failed to write "${key}" to local storage:`, error)
    }
  }

  return [storedValue, setValue]
}
