import type { ReactNode } from 'react'

export function AuthShell({
  title,
  children
}: {
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6">
      <section className="w-full max-w-md border bg-card p-8 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
          Merchant App
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-6">{children}</div>
      </section>
    </main>
  )
}
