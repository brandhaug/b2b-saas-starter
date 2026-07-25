import type { ServiceRecord } from '@b2b-saas-starter/capabilities/merchant-catalog'
import { Check, X } from 'lucide-react'
import { useState } from 'react'
import { formatMerchantPrice } from '@/lib/merchant-money.ts'
import { MobileSheetScrollport } from './mobile-sheet-scrollport.tsx'

const durationLabel = (minutes: number) => {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes === 0
    ? `${hours} ${hours === 1 ? 'hr' : 'hrs'}`
    : `${hours} hr ${remainingMinutes} min`
}

export function MobileAppointmentServicePicker({
  services,
  loading,
  error,
  selectedService,
  onBack,
  onConfirm
}: {
  readonly services: readonly ServiceRecord[]
  readonly loading: boolean
  readonly error: boolean
  readonly selectedService: ServiceRecord | null
  readonly onBack: () => void
  readonly onConfirm: (service: ServiceRecord) => void
}) {
  const [pendingService, setPendingService] = useState(selectedService)

  return (
    <div
      data-mobile-service-picker="true"
      className="relative flex h-full min-h-0 flex-col"
    >
      <header className="flex min-h-[4.75rem] shrink-0 items-center gap-3 px-4">
        <button
          type="button"
          aria-label="Back to appointment"
          onClick={onBack}
          className="-ml-2 grid size-11 place-items-center rounded-full text-muted-foreground active:bg-muted"
        >
          <X aria-hidden className="size-7" strokeWidth={1.5} />
        </button>
        <h1 className="text-[1.25rem] font-semibold">Select a service</h1>
      </header>

      <MobileSheetScrollport className="px-4">
        <div className="mx-auto grid w-full grid-cols-2 gap-2.5 pb-[max(9rem,calc(env(safe-area-inset-bottom)+7.5rem))]">
          {loading ? (
            <p className="col-span-2 text-sm text-muted-foreground">
              Loading services…
            </p>
          ) : error ? (
            <p className="col-span-2 text-sm text-muted-foreground">
              Services could not be loaded. Close and try again.
            </p>
          ) : services.length === 0 ? (
            <p className="col-span-2 text-sm text-muted-foreground">
              No bookable services are available.
            </p>
          ) : (
            services.map((service) => {
              const selected = pendingService?.id === service.id
              return (
                <button
                  key={service.id}
                  type="button"
                  aria-pressed={selected}
                  data-mobile-service-option={service.id}
                  onClick={() =>
                    setPendingService((current) =>
                      current?.id === service.id ? null : service
                    )
                  }
                  className={`relative h-[125px] min-h-[125px] overflow-hidden rounded-2xl border p-[15px] pb-[49px] text-left transition-[background-color,border-color,transform] active:scale-[0.98] ${
                    selected
                      ? 'border-muted-foreground/35 bg-muted'
                      : 'border-border bg-background'
                  }`}
                >
                  <span className="line-clamp-2 text-[0.9375rem] leading-5 font-semibold tracking-[-0.015em]">
                    {service.name}
                  </span>
                  <span className="mt-1 block text-[0.8125rem] leading-[1.125rem] text-muted-foreground">
                    {durationLabel(service.durationMinutes)}
                  </span>
                  <span
                    className={`absolute right-[-1px] bottom-[15px] rounded-l-lg px-3 py-1 text-[0.8125rem] leading-[1.125rem] font-semibold whitespace-nowrap ${
                      selected ? 'bg-background/45' : 'bg-muted'
                    }`}
                  >
                    {formatMerchantPrice(service.priceMinor, service.currency)}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </MobileSheetScrollport>

      {pendingService ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex h-[9.5rem] items-end justify-center bg-linear-to-t from-muted from-10% via-muted/85 via-20% to-transparent pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            aria-label={`Choose ${pendingService.name}`}
            data-mobile-service-confirm="true"
            onClick={() => onConfirm(pendingService)}
            className="pointer-events-auto grid size-[4.75rem] place-items-center rounded-[1.65rem] bg-info text-info-foreground shadow-xl shadow-black/20 transition-transform active:scale-95"
          >
            <Check aria-hidden className="size-9" strokeWidth={2.15} />
          </button>
        </div>
      ) : null}
    </div>
  )
}
