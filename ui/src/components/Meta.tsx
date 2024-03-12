import { Helmet } from 'react-helmet-async'

interface MetaProps {
  title?: string
}

export function Meta({ title }: MetaProps) {
  return (
    <Helmet>
      <title>{title ? `Reti Staking | ${title}` : 'Reti Staking'}</title>
      <meta name="description" content="Algorand P2P Open Staking Protocol" />
    </Helmet>
  )
}
