import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { Validator } from '@/interfaces/validator'

interface OverviewProps {
  validator: Validator
}

export function Overview({ validator }: OverviewProps) {
  const poolData = validator?.pools.map((pool, index) => ({
    name: `Pool ${index + 1}`,
    stakers: pool.totalStakers,
    staked: Number(pool.totalAlgoStaked / BigInt(1e6)),
  }))

  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart data={poolData}>
        <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis
          stroke="#888888"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `${value}`}
        />
        <Bar dataKey="staked" fill="currentColor" radius={[4, 4, 0, 0]} className="fill-primary" />
      </BarChart>
    </ResponsiveContainer>
  )
}
