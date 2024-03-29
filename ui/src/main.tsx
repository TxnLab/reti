import { DeflyWalletConnect } from '@blockshake/defly-connect'
import { DaffiWalletConnect } from '@daffiwallet/connect'
import { PeraWalletConnect } from '@perawallet/connect'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import {
  PROVIDER_ID,
  ProvidersArray,
  WalletProvider,
  useInitializeProviders,
} from '@txnlab/use-wallet'
import algosdk from 'algosdk'
import { SnackbarProvider } from 'notistack'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import ErrorBoundary from '@/components/ErrorBoundary'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/providers/ThemeProvider'
import '@/styles/main.css'
import {
  getAlgodConfigFromViteEnvironment,
  getKmdConfigFromViteEnvironment,
} from '@/utils/network/getAlgoClientConfigs'
import { routeTree } from './routeTree.gen'

// use-wallet configuration
let providersArray: ProvidersArray
if (import.meta.env.VITE_ALGOD_NETWORK === '') {
  const kmdConfig = getKmdConfigFromViteEnvironment()
  providersArray = [
    {
      id: PROVIDER_ID.KMD,
      clientOptions: {
        wallet: kmdConfig.wallet,
        password: kmdConfig.password,
        host: kmdConfig.server,
        token: String(kmdConfig.token),
        port: String(kmdConfig.port),
      },
    },
  ]
} else {
  providersArray = [
    { id: PROVIDER_ID.DEFLY, clientStatic: DeflyWalletConnect },
    { id: PROVIDER_ID.PERA, clientStatic: PeraWalletConnect },
    { id: PROVIDER_ID.DAFFI, clientStatic: DaffiWalletConnect },
    PROVIDER_ID.KIBISIS,
    { id: PROVIDER_ID.EXODUS },
  ]
}

// Tanstack Query client instance
const queryClient = new QueryClient()

// Tanstack Router instance
const router = createRouter({
  routeTree,
  context: {
    queryClient,
  },
  defaultPreloadStaleTime: 0,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

function AppProviders() {
  const algodConfig = getAlgodConfigFromViteEnvironment()

  const walletProviders = useInitializeProviders({
    providers: providersArray,
    nodeConfig: {
      network: algodConfig.network,
      nodeServer: algodConfig.server,
      nodePort: String(algodConfig.port),
      nodeToken: String(algodConfig.token),
    },
    algosdkStatic: algosdk,
  })

  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <HelmetProvider>
        <QueryClientProvider client={queryClient}>
          <SnackbarProvider maxSnack={3}>
            <WalletProvider value={walletProviders}>
              <RouterProvider router={router} />
            </WalletProvider>
          </SnackbarProvider>
        </QueryClientProvider>
      </HelmetProvider>
      <Toaster />
    </ThemeProvider>
  )
}

function App() {
  return (
    <React.StrictMode>
      <ErrorBoundary>
        <AppProviders />
      </ErrorBoundary>
    </React.StrictMode>
  )
}

const rootElement = document.getElementById('app')!
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(<App />)
}
