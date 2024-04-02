export function getRetiAppIdFromViteEnvironment(): number {
  if (!import.meta.env.VITE_RETI_APP_ID) {
    throw new Error(
      'Attempt to get Reti master validator app id without specifying VITE_RETI_APP_ID in the environment variables',
    )
  }

  return Number(import.meta.env.VITE_RETI_APP_ID)
}
