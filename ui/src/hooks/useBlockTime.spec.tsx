import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { useBlockTime } from '@/hooks/useBlockTime'
import { AVG_BLOCK_TIME_SECS } from '@/utils/tests/constants'

const createWrapper = () => {
  const queryClient = new QueryClient()
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useBlockTime', () => {
  it('returns correct data', async () => {
    const { result } = renderHook(() => useBlockTime(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.ms).not.toBe(0))

    expect(result.current.secs).toEqual(AVG_BLOCK_TIME_SECS)
  })
})
