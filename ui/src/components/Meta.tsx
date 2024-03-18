import { Helmet } from 'react-helmet-async'

interface MetaProps {
  title?: string
}

export function Meta({ title }: MetaProps) {
  return (
    <Helmet>
      <title>{title ? `Réti Pooling | ${title}` : 'Réti Pooling'}</title>
      <meta name="description" content="Algorand P2P Open Staking Protocol" />
    </Helmet>
  )
}
