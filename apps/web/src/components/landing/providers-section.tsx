import { optionalProviderModules } from '@/lib/content'
import { m } from '@b2b-saas-starter/i18n/messages'

function ProvidersSection() {
  const providers = optionalProviderModules()
  return (
    <section className="border-t border-border">
      <div className="mx-auto grid max-w-7xl items-start gap-8 px-5 py-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16">
        <div className="max-w-2xl">
          <h2 className="font-display text-balance text-3xl font-medium leading-display sm:text-4xl">
            {m.landing_optional_providers()}
          </h2>
          <p className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground">
            {m.landing_optional_providers_description()}
          </p>
        </div>
        {/* Each optional integration is paired with the job it does. */}
        <table className="w-full table-fixed border-collapse text-left sm:table-auto">
          <caption className="sr-only">{m.landing_optional_providers()}</caption>
          <thead>
            <tr className="border-b border-border font-mono text-2xs text-muted-foreground">
              <th scope="col" className="py-2 pr-4 font-medium">
                {m.showcase_provider_column()}
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                {m.common_role()}
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
                <td className="break-words py-3 pr-4 align-baseline text-sm text-muted-foreground">
                  {provider.role}
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
