import { useWallet } from '@txnlab/use-wallet-react'
import { NfdAvatar } from '@/components/NfdAvatar'
import { Validator } from '@/interfaces/validator'

interface DetailsHeaderProps {
  validator: Validator
}

export function DetailsHeader({ validator }: DetailsHeaderProps) {
  const { activeAddress } = useWallet()

  const isManager = validator.config.manager === activeAddress
  const isOwner = validator.config.owner === activeAddress
  const canEdit = isManager || isOwner

  return (
    <header className="mx-auto flex flex-col items-center gap-2 py-8 md:py-12 md:pb-8 max-w-3xl">
      {canEdit && (
        <a
          className="inline-flex items-center rounded-lg bg-muted px-3 py-1 text-sm font-medium"
          href="/docs/changelog"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="lucide lucide-blocks h-4 w-4"
          >
            <rect width="7" height="7" x="14" y="3" rx="1"></rect>
            <path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3"></path>
          </svg>{' '}
          <div
            data-orientation="vertical"
            role="none"
            className="shrink-0 bg-border w-[1px] mx-2 h-4"
          ></div>{' '}
          <span>Edit Configuration</span>
          <svg
            width="15"
            height="15"
            viewBox="0 0 15 15"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="ml-1 h-4 w-4"
          >
            <path
              d="M8.14645 3.14645C8.34171 2.95118 8.65829 2.95118 8.85355 3.14645L12.8536 7.14645C13.0488 7.34171 13.0488 7.65829 12.8536 7.85355L8.85355 11.8536C8.65829 12.0488 8.34171 12.0488 8.14645 11.8536C7.95118 11.6583 7.95118 11.3417 8.14645 11.1464L11.2929 8H2.5C2.22386 8 2 7.77614 2 7.5C2 7.22386 2.22386 7 2.5 7H11.2929L8.14645 3.85355C7.95118 3.65829 7.95118 3.34171 8.14645 3.14645Z"
              fill="currentColor"
              fillRule="evenodd"
              clipRule="evenodd"
            ></path>
          </svg>
        </a>
      )}
      <h1 className="flex items-center gap-3 sm:gap-4 text-center text-3xl font-bold leading-tight tracking-tighter md:text-6xl lg:leading-[1.1] text-balance">
        {validator.nfd ? (
          <NfdAvatar nfd={validator.nfd} className="h-8 w-8 sm:h-16 sm:w-16" />
        ) : null}
        {validator.nfd ? validator.nfd.name : `Validator ${validator.id}`}
      </h1>
      {validator.nfd?.properties?.userDefined?.bio && (
        <span
          className="max-w-[750px] px-4 sm:text-center text-base text-muted-foreground sm:text-xl"
          style={{
            display: 'inline-block',
            verticalAlign: 'top',
            textDecoration: 'inherit',
            maxWidth: '614px',
          }}
        >
          {validator.nfd.properties.userDefined.bio}
        </span>
      )}
      <div className="flex w-full items-center justify-center space-x-4 py-4 md:pb-10">
        <a
          href="#blocks"
          className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2"
        >
          Add Stake
        </a>
        <a
          href="https://github.com/shadcn-ui/ui/discussions/new?category=blocks-request"
          target="_blank"
          className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2"
        >
          Unstake
        </a>
      </div>
    </header>
  )
}
