import { QueryClient } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { blockTimeQueryOptions, constraintsQueryOptions } from '@/api/queries'
import { Layout } from '@/components/Layout'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
  walletManager: { activeAddress: string | null }
}>()({
  beforeLoad: () => {
    return {
      blockTimeQueryOptions,
      constraintsQueryOptions,
    }
  },
  loader: ({ context: { queryClient, blockTimeQueryOptions, constraintsQueryOptions } }) => {
    queryClient.ensureQueryData(blockTimeQueryOptions)
    queryClient.ensureQueryData(constraintsQueryOptions)
  },
  component: () => (
    <>
      <Layout>
        <Outlet />
      </Layout>
      <ReactQueryDevtools buttonPosition="top-right" />
      <TanStackRouterDevtools position="bottom-right" />
    </>
  ),
  notFoundComponent: () => {
    return <p>Not Found (on root route)</p>
  },
})
