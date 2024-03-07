import { Account } from '@txnlab/use-wallet'

type WalletState = {
  accounts: Account[]
  activeAccount: Account | null | undefined
}

type UseWalletState = {
  state: WalletState
}

export function getWalletStateFromLocalStorage(): WalletState {
  try {
    const serializedState = localStorage.getItem('txnlab-use-wallet')
    if (serializedState === null) {
      return {
        accounts: [],
        activeAccount: null,
      }
    }
    const parsedState = JSON.parse(serializedState) as UseWalletState
    return parsedState.state
  } catch (error) {
    console.error('Error getting wallet state:', error)
    return {
      accounts: [],
      activeAccount: null,
    }
  }
}

export function getActiveWalletAddress(): string | null {
  const state = getWalletStateFromLocalStorage()
  return state.activeAccount?.address || null
}

/**
 * This is used by the router to check if a wallet is connected before loading protected routes.
 * @returns {boolean}
 */
export function isWalletConnected(): boolean {
  const state = getWalletStateFromLocalStorage()
  return !!state.activeAccount
}
