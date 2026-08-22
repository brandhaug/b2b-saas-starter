type RuntimeRow = { readonly label: string; readonly value: string }

const CLOUDFLARE_RUNTIME: readonly RuntimeRow[] = [
  { label: 'apps/web', value: 'Worker' },
  { label: 'apps/api', value: 'Worker' },
  { label: 'apps/background', value: 'Worker (queue consumer)' },
  { label: 'Database', value: 'D1' },
  { label: 'Outbound webhooks', value: 'Queues' },
  { label: 'Outbound email', value: 'Email Service' },
  { label: 'Static assets', value: 'Worker Assets' },
  { label: 'Infrastructure', value: 'Alchemy v2' }
]

function RuntimeMapSection() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <div className="grid gap-x-20 gap-y-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div>
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            One platform. One deploy.
          </h2>
          <p className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground">
            Every resource is declared as TypeScript in{' '}
            <code className="font-mono text-xs">alchemy.run.ts</code> — Workers, D1,
            Queues, Email, secrets. The same description provisions local dev and
            production, so the whole story is{' '}
            <code className="font-mono text-xs text-signal-ink">bun run deploy</code>.
          </p>
        </div>
        <dl className="grid content-start gap-x-12 sm:grid-cols-2">
          {CLOUDFLARE_RUNTIME.map((row) => (
            <div
              key={row.label}
              className="flex items-baseline justify-between gap-4 border-b border-border py-3"
            >
              <dt className="text-sm font-medium">{row.label}</dt>
              <dd className="font-mono text-xs text-muted-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

export { RuntimeMapSection }
