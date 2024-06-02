import * as React from 'react'
import { toast } from 'sonner'

export function useCheckForUpdates() {
  React.useEffect(() => {
    // if (import.meta.env.MODE !== 'production') {
    //   return
    // }

    const checkForUpdates = async () => {
      try {
        const response = await fetch('/version.json')
        const data = await response.json()
        const deployedVersion = data.version

        console.log('Deployed version:', deployedVersion)
        console.log('Current version:', __APP_VERSION__)

        if (deployedVersion !== __APP_VERSION__) {
          toast(`A new version is available! v${deployedVersion}`, {
            action: {
              label: 'Reload',
              onClick: () => window.location.reload(),
            },
          })
        }
      } catch (error) {
        console.error('Failed to check for updates:', error)
      }
    }

    // const delay = Number(import.meta.env.VITE_UPDATE_CHECK_INTERVAL || 1000 * 60 * 5)
    const delay = Number(import.meta.env.VITE_UPDATE_CHECK_INTERVAL || 1000 * 10)

    if (Number.isNaN(delay)) {
      console.error('Invalid update check interval:', import.meta.env.VITE_UPDATE_CHECK_INTERVAL)
      return
    }

    const interval = setInterval(checkForUpdates, delay)

    return () => clearInterval(interval)
  }, [])
}
