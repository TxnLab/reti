import { State, defaultState } from '@txnlab/use-wallet-react'

export function getWalletStateFromLocalStorage(): State {
  try {
    const serializedState = localStorage.getItem('@txnlab/use-wallet:v3')
    if (serializedState === null) {
      return defaultState
    }
    const parsedState = JSON.parse(serializedState) as State
    return parsedState
  } catch (error) {
    console.error('Error getting wallet state:', error)
    return defaultState
  }
}

export function getActiveWalletAddress(): string | null {
  const state = getWalletStateFromLocalStorage()
  const wallets = state.wallets
  const activeWalletState = state.activeWallet ? wallets[state.activeWallet] || null : null
  return activeWalletState ? activeWalletState.activeAccount?.address || null : null
}

/**
 * This is used by the router to check if a wallet is connected before loading protected routes.
 * @returns {boolean}
 */
export function isWalletConnected(): boolean {
  const activeWalletAddress = getActiveWalletAddress()
  return !!activeWalletAddress
}
