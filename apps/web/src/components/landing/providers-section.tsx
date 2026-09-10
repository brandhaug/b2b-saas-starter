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
        {/* Provider, role, state is tabular data, so it reads as the same
            table the runtime bindings use rather than five identical
            icon-plus-text cards padded out with a col-span. The dot repeats
            what the status column already says in words, so it is decorative:
            the state survives without color. */}
        <table className="mt-12 w-full border-collapse text-left">
          <caption className="sr-only">{m.landing_optional_providers()}</caption>
          <thead>
            <tr className="border-b border-border font-mono text-2xs text-muted-foreground">
              <th scope="col" className="py-2 pr-4 font-medium">
                {m.landing_optional_providers()}
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                {m.common_role()}
              </th>
              <th scope="col" className="py-2 font-medium">
                {m.common_status()}
              </th>
            </tr>
          </thead>
          <tbody>
            {providers.map((provider) => (
              <tr key={provider.id} className="border-b border-border">
                <th
                  scope="row"
                  className="py-3 pr-4 align-baseline text-sm font-medium"
                >
                  <span className="flex items-center gap-2.5">
                    <provider.icon
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    {provider.name}
                  </span>
                </th>
                <td className="py-3 pr-4 align-baseline text-sm text-muted-foreground">
                  {provider.role}
                </td>
                <td className="py-3 align-baseline font-mono text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full bg-status-warn"
                    />
                    {m.provider_env_gated()}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export { ProvidersSection }
