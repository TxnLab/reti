import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { useStakersChartData } from '@/hooks/useStakersChartData'
import { MOCK_STAKED_INFO_1, MOCK_STAKED_INFO_2 } from '@/utils/tests/fixtures/boxes'

const createWrapper = () => {
  const queryClient = new QueryClient()
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useStakersChartData', () => {
  it('returns correct data', async () => {
    const { result } = renderHook(
      () =>
        useStakersChartData({
          selectedPool: 'all',
          validatorId: 1,
        }),
      {
        wrapper: createWrapper(),
      },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.stakersChartData).toEqual([
      {
        name: MOCK_STAKED_INFO_1.account,
        value: Number(MOCK_STAKED_INFO_1.balance),
        href: `https://app.dappflow.org/setnetwork?name=sandbox&redirect=explorer/account/${MOCK_STAKED_INFO_1.account}`,
      },
      {
        name: MOCK_STAKED_INFO_2.account,
        value: Number(MOCK_STAKED_INFO_2.balance),
        href: `https://app.dappflow.org/setnetwork?name=sandbox&redirect=explorer/account/${MOCK_STAKED_INFO_2.account}`,
      },
    ])
  })
})
