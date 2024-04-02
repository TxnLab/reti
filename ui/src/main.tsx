import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { SupportedWallet, WalletId, WalletManager, WalletProvider } from '@txnlab/use-wallet-react'
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
  getAlgodNetwork,
  getKmdConfigFromViteEnvironment,
} from '@/utils/network/getAlgoClientConfigs'
import { routeTree } from './routeTree.gen'

// use-wallet configuration
let wallets: SupportedWallet[]
if (import.meta.env.VITE_ALGOD_NETWORK === 'localnet') {
  const kmdConfig = getKmdConfigFromViteEnvironment()
  wallets = [
    {
      id: WalletId.KMD,
      options: {
        wallet: kmdConfig.wallet,
        baseServer: kmdConfig.server,
        token: String(kmdConfig.token),
        port: String(kmdConfig.port),
      },
    },
  ]
} else {
  wallets = [WalletId.DEFLY, WalletId.PERA, WalletId.KIBISIS, WalletId.EXODUS]
}

const algodConfig = getAlgodConfigFromViteEnvironment()
const network = getAlgodNetwork()

const walletManager = new WalletManager({
  wallets,
  network,
  algod: {
    baseServer: algodConfig.server,
    port: Number(algodConfig.port),
    token: algodConfig.token as string,
  },
})

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
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <HelmetProvider>
        <QueryClientProvider client={queryClient}>
          <SnackbarProvider maxSnack={3}>
            <WalletProvider manager={walletManager}>
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
