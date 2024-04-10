import { GitHubLogoIcon } from '@radix-ui/react-icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/utils/ui'

export function GitHub({ className = '' }) {
  return (
    <Button variant="ghost" size="icon" className={cn('h-9 w-9', className)} asChild>
      <a href="https://github.com/TxnLab/reti" target="_blank" rel="noopener noreferrer">
        <GitHubLogoIcon className="h-[1.2rem] w-[1.2rem]" />
        <span className="sr-only">GitHub</span>
      </a>
    </Button>
  )
}
