import { useQuery } from '@tanstack/react-query'
import { nfdQueryOptions } from '@/api/queries'
import { getNfdProfileUrl } from '@/utils/nfd'
import { NfdAvatar } from '@/components/NfdAvatar'

export interface NfdThumbnailProps {
  nameOrId: string | number
  link?: boolean
}

export function NfdThumbnail({ nameOrId, link = false }: NfdThumbnailProps) {
  const { data: nfd, isLoading, error } = useQuery(nfdQueryOptions(nameOrId))

  if (isLoading) {
    return <span className="text-sm">Loading...</span>
  }

  if (error || !nfd) {
    return <span className="text-sm text-red-500">Error fetching balance</span>
  }

  if (link) {
    return (
      <a
        href={getNfdProfileUrl(nfd.name)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-x-1.5 text-sm font-semibold text-foreground/75 hover:text-foreground hover:underline underline-offset-4"
      >
        <NfdAvatar nfd={nfd} className="h-6 w-6" />
        {nfd.name}
      </a>
    )
  }

  return (
    <div className="flex items-center gap-x-1.5 text-sm font-semibold text-foreground">
      <NfdAvatar nfd={nfd} className="h-6 w-6" />
      {nfd.name}
    </div>
  )
}
