import * as React from 'react'
import { Avatar, AvatarImage } from '@/components/ui/avatar'
import { Nfd } from '@/interfaces/nfd'
import { getNfdAvatarUrl } from '@/utils/nfd'

interface NfdAvatarProps {
  nfd: Nfd
  className?: string
}

const NfdAvatar: React.FC<NfdAvatarProps> = React.memo(function NfdAvatar({ nfd, className = '' }) {
  return (
    <Avatar className={className}>
      <AvatarImage src={getNfdAvatarUrl(nfd)} alt={nfd.name} />
    </Avatar>
  )
})

export { NfdAvatar }
