import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { Validator } from '@/interfaces/validator'

interface OverviewProps {
  validator: Validator
}

export function Staked({ validator }: OverviewProps) {
  const poolData = validator?.pools.map((pool, index) => ({
    name: `Pool ${index + 1}`,
    stakers: pool.totalStakers,
    staked: Number(pool.totalAlgoStaked / BigInt(1e6)),
  }))

  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart
        data={poolData}
        margin={{
          top: 20,
          bottom: 20,
          left: 20,
          right: 20,
        }}
      >
        {/*<Tooltip />*/}
        <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis
          stroke="#888888"
          fontSize={12}
          tickLine={true}
          axisLine={true}
          tickFormatter={(value) => `${value}`}
        />
        <Bar
          dataKey="staked"
          // fill="#8884d8"
          maxBarSize={100}
          className="fill-primary"
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function Stakers({ validator }: OverviewProps) {
  const poolData = validator?.pools.map((pool, index) => ({
    name: `Pool ${index + 1}`,
    stakers: pool.totalStakers,
    staked: Number(pool.totalAlgoStaked / BigInt(1e6)),
  }))

  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart
        data={poolData}
        margin={{
          top: 20,
          bottom: 20,
          left: 20,
          right: 20,
        }}
      >
        {/*<Tooltip />*/}
        <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis
          stroke="#888888"
          domain={[0, 200]}
          fontSize={12}
          tickLine={true}
          axisLine={true}
          tickFormatter={(value) => `${value}`}
        />
        <Bar
          dataKey="stakers"
          // fill="#82ca9d"
          maxBarSize={100}
          // would be nice to show label on each bar but it looks horrible unless it can be offset somehow
          // label={{ fill: 'red', fontSize: 20 }}
          className="fill-primary"
        />
      </BarChart>
    </ResponsiveContainer>
  )
}
