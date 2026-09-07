import { optionalProviderModules } from '@/lib/content'
import { m } from '@b2b-saas-starter/i18n/messages'

function ProvidersSection() {
  const providers = optionalProviderModules()
  return (
    <section className="border-t border-border bg-muted/40">
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
        <div className="max-w-2xl">
          <h2 className="font-display text-balance text-3xl font-semibold sm:text-4xl">
            {m.landing_optional_providers()}
          </h2>
          <p className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground">
            {m.landing_optional_providers_description()}
          </p>
        </div>
        <div className="mt-12 grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
          {providers.map((provider, index) => (
            <div
              key={provider.id}
              className={`flex flex-col gap-6 bg-background p-5 ${
                index === providers.length - 1 ? 'sm:col-span-2 lg:col-span-1' : ''
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
                <span className="font-mono text-xs text-signal-ink">
                  {m.provider_env_gated()}
                </span>
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export { ProvidersSection }
