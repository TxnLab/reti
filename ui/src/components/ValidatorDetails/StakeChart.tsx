import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Validator } from '@/interfaces/validator'

interface StakeChartProps {
  validator: Validator
}

export function StakeChart({ validator }: StakeChartProps) {
  const poolData = validator?.pools.map((pool, index) => ({
    name: `Pool ${index + 1}`,
    stakers: pool.totalStakers,
    staked: Number(pool.totalAlgoStaked / BigInt(1e6)),
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stake by Pool</CardTitle>
      </CardHeader>
      <CardContent className="pl-1">
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
              fontSize={12}
              tickLine={true}
              axisLine={true}
              tickFormatter={(value) => `${value}`}
            />
            <Bar dataKey="staked" maxBarSize={100} className="fill-primary" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
