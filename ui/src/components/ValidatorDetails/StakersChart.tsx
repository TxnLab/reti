import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Validator } from '@/interfaces/validator'

interface StakersChartProps {
  validator: Validator
}

export function StakersChart({ validator }: StakersChartProps) {
  const poolData = validator?.pools.map((pool, index) => ({
    name: `Pool ${index + 1}`,
    stakers: pool.totalStakers,
    staked: Number(pool.totalAlgoStaked / BigInt(1e6)),
  }))

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Stakers in Pool</CardTitle>
      </CardHeader>
      <CardContent className="pl-2">
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
            <XAxis
              dataKey="name"
              stroke="#888888"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="#888888"
              domain={[0, 200]}
              fontSize={12}
              tickLine={true}
              axisLine={true}
              tickFormatter={(value) => `${value}`}
            />
            <Bar dataKey="stakers" maxBarSize={100} className="fill-primary" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
