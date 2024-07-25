import { DonutChart, EventProps } from '@tremor/react'
import { AlgoDisplayAmount } from '@/components/AlgoDisplayAmount'

type PoolChartData = {
  name: string
  value: number
}

interface PoolsChartProps {
  data: PoolChartData[]
  onValueChange: (value: EventProps) => void
  className?: string
}

export function PoolsChart({ data, onValueChange, className = '' }: PoolsChartProps) {
  return (
    <DonutChart
      data={data}
      variant="donut"
      index="name"
      colors={[
        'primary-600',
        'pink-600',
        'fuchsia-600',
        'purple-600',
        'violet-600',
        'indigo-600',
        'blue-600',
        'sky-600',
        'cyan-600',
        'teal-600',
        'emerald-600',
        'green-600',
        'lime-600',
        'yellow-600',
        'amber-600',
        'orange-600',
        'red-600',
        'primary-500',
        'pink-500',
        'fuchsia-500',
        'purple-500',
        'violet-500',
        'indigo-500',
        'blue-500',
      ]}
      onValueChange={onValueChange}
      customTooltip={customTooltip}
      showAnimation={true}
      showLabel={false}
      className={className}
    />
  )
}

type CustomTooltipTypeDonut = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any
  active: boolean | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  label: any
}

function customTooltip(props: CustomTooltipTypeDonut) {
  const { payload, active } = props
  if (!active || !payload) return null

  const categoryPayload = payload?.[0]
  if (!categoryPayload) return null

  // Pools with no stake are set to 1 microalgo for the chart, but tooltip should show correct total (0)
  const algoAmount = categoryPayload.value === 0.000001 ? 0 : categoryPayload.value

  return (
    <div className="w-56 rounded-tremor-default border border-tremor-border bg-tremor-background p-2 text-tremor-default shadow-tremor-dropdown dark:border-dark-tremor-border dark:bg-stone-950">
      <div className="flex flex-1 space-x-2.5">
        <div className={`flex w-1.5 flex-col bg-${categoryPayload?.color} rounded`} />
        <div className="w-full">
          <div className="flex items-center justify-between space-x-8">
            <p className="whitespace-nowrap text-right text-tremor-content dark:text-dark-tremor-content">
              {categoryPayload.name}
            </p>
            <p className="whitespace-nowrap text-right text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis">
              <AlgoDisplayAmount
                amount={algoAmount}
                maxLength={13}
                compactPrecision={2}
                mutedRemainder
                className="font-mono"
              />
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
