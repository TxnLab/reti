import { Avatar, AvatarImage } from '@/components/ui/avatar'
import { Nfd } from '@/interfaces/nfd'
import { getNfdAvatarUrl } from '@/utils/nfd'

interface NfdAvatarProps {
  nfd: Nfd
  className?: string
}

export function NfdAvatar({ nfd, className = '' }: NfdAvatarProps) {
  return (
    <Avatar className={className}>
      <AvatarImage src={getNfdAvatarUrl(nfd)} alt={nfd.name} />
    </Avatar>
  )
}
