import type { ReactNode } from 'react'
import { BeeSoloLogo } from './beesolo-logo.tsx'

export function AuthShell({
  title,
  children
}: {
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6">
      <section className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm">
        <BeeSoloLogo />
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Merchant workspace
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-6">{children}</div>
      </section>
    </main>
  )
}
