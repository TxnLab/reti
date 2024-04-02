export function PageHeader({ title }: { title?: string | null }) {
  if (!title) return null
  return (
    <header>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-stone-900 dark:text-white">
          {title}
        </h1>
      </div>
    </header>
  )
}
