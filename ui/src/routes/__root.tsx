import { QueryClient } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { blockTimeQueryOptions, constraintsQueryOptions, mbrQueryOptions } from '@/api/queries'
import { Layout } from '@/components/Layout'
import { useCheckForUpdates } from '@/hooks/useCheckForUpdates'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
  walletManager: { activeAddress: string | null }
}>()({
  beforeLoad: () => {
    return {
      blockTimeQueryOptions,
      constraintsQueryOptions,
      mbrQueryOptions,
    }
  },
  loader: ({
    context: { queryClient, blockTimeQueryOptions, constraintsQueryOptions, mbrQueryOptions },
  }) => {
    queryClient.ensureQueryData(blockTimeQueryOptions)
    queryClient.ensureQueryData(constraintsQueryOptions)
    queryClient.ensureQueryData(mbrQueryOptions)
  },
  component: Root,
  notFoundComponent: () => {
    return <p>Not Found (on root route)</p>
  },
})

function Root() {
  useCheckForUpdates()

  return (
    <>
      <Layout>
        <Outlet />
      </Layout>
      {import.meta.env.DEV && (
        <>
          <ReactQueryDevtools buttonPosition="top-right" />
          <TanStackRouterDevtools position="bottom-right" />
        </>
      )}
    </>
  )
}
