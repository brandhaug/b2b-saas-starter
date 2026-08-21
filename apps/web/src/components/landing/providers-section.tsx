import { optionalProviderModules } from '@/lib/content'

function ProvidersSection() {
  return (
    <section className="border-t border-border bg-muted/40">
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
        <div className="max-w-2xl">
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Every provider is optional.
          </h2>
          <p className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground">
            Stripe, Sentry, PostHog, Email, and GitHub OAuth ship with real routes,
            models, and settings that stay inactive until their env vars exist. Local
            development never blocks on a provider account.
          </p>
        </div>
        <div className="mt-12 grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
          {optionalProviderModules.map((provider, index) => (
            <div
              key={provider.id}
              className={`flex flex-col gap-6 bg-background p-5 ${
                index === optionalProviderModules.length - 1
                  ? 'sm:col-span-2 lg:col-span-1'
                  : ''
              }`}
            >
              <div className="flex items-center gap-2.5">
                <provider.icon className="size-4 text-muted-foreground" />
                <p className="text-sm font-medium">{provider.name}</p>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {provider.role}
              </p>
              <p className="mt-auto inline-flex items-center gap-2">
                <span className="size-2 rounded-full border border-signal-ink" />
                <span className="font-mono text-xs text-signal-ink">env-gated</span>
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export { ProvidersSection }
