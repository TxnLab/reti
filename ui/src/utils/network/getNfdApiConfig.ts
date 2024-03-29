export function getNfdApiFromViteEnvironment(): string {
  if (!import.meta.env.VITE_NFD_API_URL) {
    throw new Error(
      'Attempt to get NFD API base URL without specifying VITE_NFD_API_URL in the environment variables',
    )
  }

  return import.meta.env.VITE_NFD_API_URL
}
