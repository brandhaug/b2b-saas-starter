import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import type {
  MerchantCatalogSnapshot,
  ServiceRecord
} from '@b2b-saas-starter/capabilities/merchant-catalog'
import { MerchantShell } from '@/components/merchant-shell/index.ts'
import { serviceProviderChoices } from '@/lib/catalog-workflow.ts'
import { formValue } from '@/lib/form-value.ts'
import {
  formatMerchantPrice,
  merchantPriceInputStep,
  merchantPriceInputValue,
  merchantPriceMinorFromMajor
} from '@/lib/merchant-money.ts'
import {
  getMerchantCatalog,
  saveMerchantService,
  saveServiceEligibility
} from '@/lib/server/merchant-catalog.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/services')({
  beforeLoad: async ({ location }) => requireMerchantSession(location.href),
  loader: () => getMerchantCatalog(),
  component: ServicesPage
})

function ServicesPage() {
  const catalog = Route.useLoaderData()
  const [selectedId, setSelectedId] = useState<string | null>(
    catalog.services[0]?.id ?? null
  )
  const [continueToProvidersId, setContinueToProvidersId] = useState<string | null>(
    null
  )
  const selected = catalog.services.find((service) => service.id === selectedId) ?? null

  return (
    <MerchantShell
      section={{ kind: 'catalog', presentation: catalog.presentation }}
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
                <Lifecycle status={service.status} />
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

function ServiceEditor({
  catalog,
  service,
  initialStep,
  onSaved
}: {
  readonly catalog: MerchantCatalogSnapshot
  readonly service: ServiceRecord | null
  readonly initialStep: 'details' | 'providers'
  readonly onSaved: (id: string) => void
}) {
  const router = useRouter()
  const [step, setStep] = useState<'details' | 'providers'>(initialStep)
  const [currency, setCurrency] = useState(service?.currency ?? 'RON')
  const choices = service ? serviceProviderChoices(catalog, service.id) : []
  const [providerIds, setProviderIds] = useState(
    () => new Set(choices.flatMap((choice) => (choice.selected ? [choice.id] : [])))
  )
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const finish = (text: string) => {
    setMessage(text)
    setPending(false)
    void router.invalidate()
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border bg-muted/20 md:rounded-none md:border-0 md:bg-transparent">
      <div className="grid grid-cols-2 border-b border-border/70 bg-muted p-1">
        <StepButton active={step === 'details'} onClick={() => setStep('details')}>
          1 · Details
        </StepButton>
        <StepButton
          active={step === 'providers'}
          disabled={!service}
          onClick={() => setStep('providers')}
        >
          2 · Providers
        </StepButton>
      </div>
      {step === 'details' ? (
        <form
          className="grid gap-3 p-4 md:gap-4 md:p-5"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const currency = formValue(form, 'currency').toUpperCase()
            setPending(true)
            setMessage(null)
            void saveMerchantService({
              data: {
                ...(service ? { id: service.id } : {}),
                name: formValue(form, 'name'),
                description: formValue(form, 'description') || null,
                category: formValue(form, 'category') || null,
                durationMinutes: Number(formValue(form, 'durationMinutes')),
                priceMinor: merchantPriceMinorFromMajor(
                  Number(formValue(form, 'priceMajor')),
                  currency
                ),
                currency,
                status: formValue(form, 'status') as 'active' | 'inactive'
              }
            })
              .then((saved) => {
                onSaved(saved.id)
                setStep('providers')
                finish('Service details saved.')
              })
              .catch(() => finish('Check the Service values and try again.'))
          }}
        >
          <p className="text-sm font-semibold">
            {service ? 'Edit service details' : 'Create service'}
          </p>
          <Field label="Name" name="name" defaultValue={service?.name} required />
          <label className="grid gap-1.5 text-sm">
            Display description{' '}
            <span className="text-xs text-muted-foreground">Optional</span>
            <textarea
              name="description"
              defaultValue={service?.description ?? ''}
              maxLength={300}
              className="min-h-24 rounded-xl border bg-card px-3 py-2 md:rounded-md"
            />
          </label>
          <Field
            label="Category (optional)"
            name="category"
            defaultValue={service?.category ?? ''}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Duration (minutes)"
              name="durationMinutes"
              type="number"
              min={1}
              defaultValue={service?.durationMinutes ?? 30}
              required
            />
            <Field
              label="Price"
              name="priceMajor"
              type="number"
              min={merchantPriceInputStep(currency)}
              step={merchantPriceInputStep(currency)}
              defaultValue={merchantPriceInputValue(
                service?.priceMinor ?? 5000,
                service?.currency ?? 'RON'
              )}
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Currency"
              name="currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              minLength={3}
              maxLength={3}
              required
            />
            <SelectField
              label="Lifecycle"
              name="status"
              defaultValue={service?.status ?? 'active'}
            />
          </div>
          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
          <button
            type="submit"
            disabled={pending}
            className="h-10 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground md:h-9 md:rounded-md"
          >
            {pending
              ? 'Saving…'
              : service
                ? 'Save and continue'
                : 'Create and continue'}
          </button>
        </form>
      ) : service ? (
        <div className="p-4 md:p-5">
          <p className="text-sm font-semibold">Provider eligibility</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Eligibility is stored explicitly. Default status and Merchant membership do
            not assign a Provider.
          </p>
          <div className="mt-5 grid gap-2">
            {choices.map((choice) => (
              <label
                key={choice.id}
                className="flex min-h-12 items-center gap-3 rounded-xl border p-3 text-sm font-medium md:rounded-md"
              >
                <input
                  type="checkbox"
                  checked={providerIds.has(choice.id)}
                  onChange={(event) =>
                    setProviderIds((current) => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(choice.id)
                      else next.delete(choice.id)
                      return next
                    })
                  }
                />
                {choice.displayName}
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setPending(true)
              void saveServiceEligibility({
                data: { serviceId: service.id, providerIds: [...providerIds] }
              })
                .then(() => finish('Provider eligibility saved.'))
                .catch(() => finish('Eligibility could not be saved.'))
            }}
            className="mt-5 h-10 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground md:h-9 md:rounded-md"
          >
            {pending ? 'Saving…' : 'Save eligibility'}
          </button>
          {message ? (
            <p className="mt-3 text-sm text-muted-foreground">{message}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function StepButton({
  active,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { readonly active: boolean }) {
  return (
    <button
      type="button"
      className={`h-9 rounded-xl text-sm font-medium md:rounded-md ${active ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
      {...props}
    />
  )
}

function Field({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { readonly label: string }) {
  return (
    <label className="grid gap-1.5 text-sm">
      {label}
      <input
        className="h-10 rounded-xl border bg-card px-3 md:h-9 md:rounded-md"
        {...props}
      />
    </label>
  )
}

function SelectField({
  label,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { readonly label: string }) {
  return (
    <label className="grid gap-1.5 text-sm">
      {label}
      <select
        className="h-10 rounded-xl border bg-card px-3 md:h-9 md:rounded-md"
        {...props}
      >
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>
    </label>
  )
}

function Lifecycle({ status }: { readonly status: 'active' | 'inactive' }) {
  return (
    <span
      className={`inline-flex h-[22px] items-center rounded-md px-2 py-1 text-xs font-medium capitalize ${status === 'active' ? 'bg-accent text-accent-foreground' : 'bg-secondary text-muted-foreground'}`}
    >
      {status}
    </span>
  )
}
