import { useState } from 'react'
import type {
  MerchantCatalogSnapshot,
  ServiceRecord
} from '@b2b-saas-starter/capabilities/merchant-catalog'
import { MerchantShell } from '@/components/merchant-shell/index.ts'
import { formatMerchantPrice } from '@/lib/merchant-money.ts'
import { ServiceEditor } from './service-editor.tsx'

export function ServicesPage({
  catalog
}: {
  readonly catalog: MerchantCatalogSnapshot
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    catalog.services[0]?.id ?? null
  )
  const [continueToProvidersId, setContinueToProvidersId] = useState<string | null>(
    null
  )
  const selected = catalog.services.find((service) => service.id === selectedId) ?? null

  return (
    <MerchantShell
      section={{ kind: 'catalog' }}
      title="Services"
      description="Configure customer-facing details first, then choose the Providers who can perform each Service. Inactive Services stay available for history."
    >
      <div className="mt-2 grid gap-3 md:mt-8 md:gap-0 md:overflow-hidden md:border md:bg-card lg:grid-cols-[minmax(18rem,0.8fr)_minmax(22rem,1.2fr)]">
        <div className="overflow-hidden rounded-2xl border bg-muted/30 md:rounded-none md:border-0 md:border-b md:bg-transparent lg:border-r lg:border-b-0">
          <div className="flex min-h-14 items-center justify-between border-b border-border/70 px-4">
            <p className="text-sm font-semibold">Catalog</p>
            <button
              type="button"
              onClick={() => {
                setContinueToProvidersId(null)
                setSelectedId(null)
              }}
              className="h-8 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground md:h-9 md:rounded-md"
            >
              New service
            </button>
          </div>
          {catalog.services.length ? (
            catalog.services.map((service) => (
              <button
                key={service.id}
                type="button"
                onClick={() => {
                  setContinueToProvidersId(null)
                  setSelectedId(service.id)
                }}
                className={`grid min-h-16 w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-border/70 px-4 py-3 text-left last:border-b-0 active:bg-muted/70 md:py-4 ${service.id === selected?.id ? 'bg-accent' : 'md:hover:bg-muted'}`}
              >
                <span>
                  <span className="block text-sm font-medium">{service.name}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {service.durationMinutes} min ·{' '}
                    {formatMerchantPrice(service.priceMinor, service.currency)}
                  </span>
                </span>
                <ServiceLifecycle status={service.status} />
              </button>
            ))
          ) : (
            <p className="p-4 text-sm leading-5 text-muted-foreground md:p-5">
              Create the first Service customers will be able to book.
            </p>
          )}
        </div>
        <ServiceEditor
          key={selected?.id ?? 'new'}
          catalog={catalog}
          service={selected}
          initialStep={selected?.id === continueToProvidersId ? 'providers' : 'details'}
          onSaved={(id) => {
            setContinueToProvidersId(id)
            setSelectedId(id)
          }}
        />
      </div>
    </MerchantShell>
  )
}

function ServiceLifecycle({ status }: { readonly status: ServiceRecord['status'] }) {
  return (
    <span
      className={`inline-flex h-[22px] items-center rounded-md px-2 py-1 text-xs font-medium capitalize ${status === 'active' ? 'bg-accent text-accent-foreground' : 'bg-secondary text-muted-foreground'}`}
    >
      {status}
    </span>
  )
}
