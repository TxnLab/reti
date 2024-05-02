import { QueryClient } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { suggestedParamsQueryOptions } from '@/api/queries'
import { Layout } from '@/components/Layout'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
  walletManager: { activeAddress: string | null }
}>()({
  beforeLoad: () => {
    return {
      suggestedParamsQueryOptions,
    }
  },
  loader: ({ context: { queryClient, suggestedParamsQueryOptions } }) => {
    queryClient.ensureQueryData(suggestedParamsQueryOptions)
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
