import * as React from 'react'
import { toast } from 'sonner'

export function useCheckForUpdates() {
  React.useEffect(() => {
    if (import.meta.env.MODE !== 'production') {
      return
    }

    const checkForUpdates = async () => {
      try {
        const response = await fetch('/version.json')
        const data = await response.json()
        const deployedVersion = data.version

        if (deployedVersion !== __APP_VERSION__) {
          toast(`A new version is available! v${deployedVersion}`, {
            description: 'Click the Reload button to update the app.',
            action: {
              label: 'Reload',
              onClick: () => window.location.reload(),
            },
            id: 'new-version',
            duration: Infinity,
          })
        }
      } catch (error) {
        console.error('Failed to check for updates:', error)
      }
    }

    const delay = Number(import.meta.env.VITE_UPDATE_CHECK_INTERVAL || 1000 * 60)

    if (Number.isNaN(delay)) {
      console.error('Invalid update check interval:', import.meta.env.VITE_UPDATE_CHECK_INTERVAL)
      return
    }

    const interval = setInterval(checkForUpdates, delay)

    return () => clearInterval(interval)
  }, [])
}
