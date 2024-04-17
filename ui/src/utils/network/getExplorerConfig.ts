export interface ExplorerConfig {
  accountUrl: string
  transactionUrl: string
  assetUrl: string
  appUrl: string
}

export function getExplorerConfigFromViteEnvironment(): ExplorerConfig {
  if (!import.meta.env.VITE_EXPLORER_ACCOUNT_URL) {
    throw new Error(
      'Attempt to get block explorer config without specifying VITE_EXPLORER_ACCOUNT_URL in the environment variables',
    )
  }

  return {
    accountUrl: import.meta.env.VITE_EXPLORER_ACCOUNT_URL,
    transactionUrl: import.meta.env.VITE_EXPLORER_TRANSACTION_URL,
    assetUrl: import.meta.env.VITE_EXPLORER_ASSET_URL,
    appUrl: import.meta.env.VITE_EXPLORER_APPLICATION_URL,
  }
}
