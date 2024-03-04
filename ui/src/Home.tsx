import React from 'react'
import { ExampleDataTable } from '@/components/ExampleDataTable'
import { Layout } from '@/components/Layout'

interface HomeProps {}

const Home: React.FC<HomeProps> = () => {
  return (
    <Layout title="Dashboard">
      <ExampleDataTable />
    </Layout>
  )
}

export default Home
