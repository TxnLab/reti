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
