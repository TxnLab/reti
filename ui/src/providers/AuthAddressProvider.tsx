import { useWallet } from '@txnlab/use-wallet-react'
import * as React from 'react'
import { fetchAccountInformation } from '@/api/algod'

interface IContext {
  authAddress: string | undefined
  isReady: boolean
}

const AuthAddressContext = React.createContext<IContext>({} as IContext)

export const useAuthAddress = (): IContext => {
  const context = React.useContext(AuthAddressContext)
  if (!context) {
    throw new Error('useAuthAddress must be used within a AuthAddressProvider')
  }
  return context
}

export function AuthAddressProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [authAddress, setAuthAddress] = React.useState<string | undefined>(undefined)
  const [isReady, setIsReady] = React.useState<boolean>(false)

  const { activeAddress } = useWallet()

  React.useEffect(() => {
    const fetchAuthAddress = async () => {
      try {
        const accountInfo = await fetchAccountInformation(activeAddress!, 'all')
        const authAddr = accountInfo['auth-addr']
        setAuthAddress(authAddr)
      } catch (error) {
        console.error(`Error fetching active wallet's authorized address:`, error)
        setAuthAddress(undefined)
      } finally {
        setIsReady(true)
      }
    }

    if (activeAddress) {
      setIsReady(false)
      fetchAuthAddress()
    } else {
      setAuthAddress(undefined)
    }
  }, [activeAddress])

  return (
    <AuthAddressContext.Provider value={{ authAddress, isReady }}>
      {children}
    </AuthAddressContext.Provider>
  )
}
