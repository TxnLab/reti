import * as React from 'react'
import { Avatar, AvatarImage } from '@/components/ui/avatar'
import { Nfd } from '@/interfaces/nfd'
import { getNfdAvatarUrl } from '@/utils/nfd'

interface NfdAvatarProps {
  nfd: Nfd
  className?: string
  alt?: string
}

const NfdAvatar: React.FC<NfdAvatarProps> = React.memo(function NfdAvatar({
  nfd,
  className = '',
  alt,
}) {
  return (
    <Avatar className={className}>
      <AvatarImage src={getNfdAvatarUrl(nfd)} alt={alt || nfd.name} />
    </Avatar>
  )
})

export { NfdAvatar }
