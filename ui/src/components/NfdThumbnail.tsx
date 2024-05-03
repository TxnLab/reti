import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { nfdQueryOptions } from '@/api/queries'
import { NfdAvatar } from '@/components/NfdAvatar'
import { Tooltip } from '@/components/Tooltip'
import { Nfd } from '@/interfaces/nfd'
import { getNfdProfileUrl } from '@/utils/nfd'
import { cn } from '@/utils/ui'

type NfdThumbnailProps = (
  | {
      nfd: Nfd
      nameOrId?: never
    }
  | {
      nfd?: never
      nameOrId: string | number
    }
) & {
  link?: boolean
  truncate?: boolean
  tooltip?: boolean
  className?: string
}

function NfdThumbnailBase({
  nfd: nfdProp,
  nameOrId,
  link = false,
  truncate = false,
  tooltip = false,
  className = '',
}: NfdThumbnailProps) {
  const { data: nfdData, isLoading, error } = useQuery(nfdQueryOptions(nameOrId || ''))
  const nfd = nfdProp || nfdData

  if (isLoading) {
    return <span className="text-sm">Loading...</span>
  }

  if (error || !nfd) {
    return <span className="text-sm text-red-500">Error fetching NFD</span>
  }

  const defaultClassName = 'flex items-center gap-x-1.5 text-sm font-semibold text-foreground'

  const renderChildren = () => (
    <>
      <div className="flex-shrink-0">
        <NfdAvatar nfd={nfd} className="h-6 w-6" />
      </div>
      <div className={cn({ truncate })}>{nfd.name}</div>
    </>
  )

  const renderThumbnail = () => (
    <div className={cn(defaultClassName, className)}>{renderChildren()}</div>
  )

  const renderLink = () => (
    <a
      href={getNfdProfileUrl(nfd.name)}
      target="_blank"
      rel="noreferrer"
      className={cn(defaultClassName, className)}
    >
      {renderChildren()}
    </a>
  )

  const renderContent = () => (link ? renderLink() : renderThumbnail())

  if (tooltip) {
    return <Tooltip content={nfd.name}>{renderContent()}</Tooltip>
  }

  return renderContent()
}

const NfdThumbnail = (props: NfdThumbnailProps) => {
  const MemoizedNfdThumbnail = React.memo(NfdThumbnailBase)

  if (props.nfd) {
    return <MemoizedNfdThumbnail {...props} />
  } else {
    return <NfdThumbnailBase {...props} />
  }
}

export { NfdThumbnail }
