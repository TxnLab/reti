import { Separator } from '@/components/ui/separator'

interface PageHeaderProps {
  title?: string | null
  description?: string
  separator?: boolean
}

export function PageHeader({ title, description, separator = false }: PageHeaderProps) {
  if (!title) return null
  return (
    <header>
      <div className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
        <h1
          className="text-3xl font-bold leading-tight tracking-tight text-stone-900 dark:text-white"
          data-test-id="page-title"
        >
          {title}
        </h1>
        {description && <p className="mt-2 text-lg text-muted-foreground">{description}</p>}
        {separator && <Separator className="my-8" />}
      </div>
    </header>
  )
}
