import { useWallet } from '@txnlab/use-wallet-react'
import * as React from 'react'

export function WalletShortcutHandler() {
  const { activeWallet } = useWallet()

  const handleDisconnect = React.useCallback(() => {
    if (activeWallet) {
      activeWallet.disconnect()
    }
  }, [activeWallet])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.shiftKey && event.key === 'D') {
        handleDisconnect()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleDisconnect])

  return null
}
