export function getNfdApiFromViteEnvironment(): string {
  if (!import.meta.env.VITE_NFD_API_URL) {
    throw new Error(
      'Attempt to get NFD API base URL without specifying VITE_NFD_API_URL in the environment variables',
    )
  }

  return import.meta.env.VITE_NFD_API_URL
}

export function getNfdAppFromViteEnvironment(): string {
  if (!import.meta.env.VITE_NFD_APP_URL) {
    throw new Error(
      'Attempt to get NFD app base URL without specifying VITE_NFD_APP_URL in the environment variables',
    )
  }

  return import.meta.env.VITE_NFD_APP_URL
}

export function getNfdRegistryFromViteEnvironment(): number {
  if (!import.meta.env.VITE_NFD_REGISTRY_APP_ID) {
    throw new Error(
      'Attempt to get NFD registry app ID without specifying VITE_NFD_REGISTRY_APP_ID in the environment variables',
    )
  }

  return parseInt(import.meta.env.VITE_NFD_REGISTRY_APP_ID)
}

export function getNfdAdminAssetFromViteEnvironment(): number {
  if (!import.meta.env.VITE_NFD_ADMIN_ASSET_ID) {
    throw new Error(
      'Attempt to get NFD admin asset ID without specifying VITE_NFD_ADMIN_ASSET_ID in the environment variables',
    )
  }

  return parseInt(import.meta.env.VITE_NFD_ADMIN_ASSET_ID)
}
