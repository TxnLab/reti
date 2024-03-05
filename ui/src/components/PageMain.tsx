import React from 'react'

export function PageMain({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="py-10">{children}</div>
      </div>
    </main>
  )
}
