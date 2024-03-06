export function getRetiAppIdFromViteEnvironment(): number {
  if (!import.meta.env.VITE_RETI_APP_ID) {
    throw new Error(
      'Attempt to get Reti master validator app ID without specifying VITE_RETI_APP_ID in the environment variables',
    )
  }

  return Number(import.meta.env.VITE_RETI_APP_ID)
}

export function getNfdRegistryAppIdFromViteEnvironment(): number {
  if (!import.meta.env.VITE_NFD_REGISTRY_APP_ID) {
    throw new Error(
      'Attempt to get NFD registry app ID without specifying VITE_NFD_REGISTRY_APP_ID in the environment variables',
    )
  }

  return Number(import.meta.env.VITE_NFD_REGISTRY_APP_ID)
}
