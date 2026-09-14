import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { PlusIcon, MinusIcon, ArrowRightIcon } from 'lucide-react'
import { optionalProviderModules } from '@/lib/content'
import { Button } from '@/components/ui/button'
import { m } from '@b2b-saas-starter/i18n/messages'

function ProvidersSection() {
  const [expanded, setExpanded] = useState('stripe')
  return (
    <section
      className="border-t border-border bg-muted/40"
      aria-labelledby="providers-heading"
    >
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:py-32">
        <div className="max-w-2xl">
          <h2
            id="providers-heading"
            className="font-display text-balance text-3xl font-semibold sm:text-4xl"
          >
            {m.landing_optional_providers()}
          </h2>
          <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
            {m.landing_optional_providers_description()}
          </p>
        </div>
        <div className="mt-12 flex flex-col border border-border lg:min-h-80 lg:flex-row">
          {optionalProviderModules().map((provider) => (
            <article
              key={provider.id}
              className={`min-w-0 border-b border-border bg-card last:border-0 motion-safe:transition-[flex] motion-safe:duration-500 lg:border-r lg:border-b-0 ${expanded === provider.id ? 'lg:flex-3' : 'lg:flex-1'}`}
            >
              <h3>
                <Button
                  type="button"
                  variant="ghost"
                  id={`provider-trigger-${provider.id}`}
                  aria-expanded={expanded === provider.id}
                  aria-controls={`provider-panel-${provider.id}`}
                  onClick={() =>
                    setExpanded(expanded === provider.id ? '' : provider.id)
                  }
                  className="h-auto min-h-20 w-full items-start justify-between gap-3 rounded-none px-5 py-6 text-left whitespace-normal lg:min-h-32 lg:flex-col"
                >
                  <span className="flex items-center gap-3">
                    <provider.icon
                      aria-hidden
                      className="size-5 shrink-0 text-primary"
                    />
                    <span>{provider.name}</span>
                  </span>
                  {expanded === provider.id ? (
                    <MinusIcon aria-hidden className="size-4 shrink-0" />
                  ) : (
                    <PlusIcon aria-hidden className="size-4 shrink-0" />
                  )}
                </Button>
              </h3>
              <div
                id={`provider-panel-${provider.id}`}
                aria-labelledby={`provider-trigger-${provider.id}`}
                hidden={expanded !== provider.id}
                className="px-5 pb-6"
              >
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {provider.role}
                </p>
                <p className="mt-6 flex items-center gap-2 text-sm">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full bg-status-warn"
                  />
                  {m.provider_env_gated()}
                </p>
                <Link
                  to="/docs"
                  className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm underline underline-offset-4 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {m.showcase_read_docs()}
                  <ArrowRightIcon aria-hidden className="size-4" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
export { ProvidersSection }
