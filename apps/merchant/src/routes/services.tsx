import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import type {
  MerchantCatalogSnapshot,
  ServiceRecord
} from '@b2b-saas-starter/capabilities'
import { CatalogShell } from '@/components/catalog-shell.tsx'
import { serviceProviderChoices } from '@/lib/catalog-workflow.ts'
import { formValue } from '@/lib/form-value.ts'
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
  const selected = catalog.services.find((service) => service.id === selectedId) ?? null

  return (
    <CatalogShell
      catalog={catalog}
      title="Services"
      description="Configure customer-facing details first, then choose the Providers who can perform each Service. Inactive Services stay available for history."
    >
      <div className="mt-8 grid overflow-hidden rounded-lg border bg-card lg:grid-cols-[minmax(18rem,0.8fr)_minmax(22rem,1.2fr)]">
        <div className="border-b lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-semibold">Catalog</p>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              New Service
            </button>
          </div>
          {catalog.services.length ? (
            catalog.services.map((service) => (
              <button
                key={service.id}
                type="button"
                onClick={() => setSelectedId(service.id)}
                className={`grid w-full grid-cols-[1fr_auto] gap-3 border-b px-4 py-4 text-left last:border-b-0 ${service.id === selected?.id ? 'bg-accent' : 'hover:bg-muted'}`}
              >
                <span>
                  <span className="block text-sm font-medium">{service.name}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {service.durationMinutes} min · {service.priceMinor}{' '}
                    {service.currency} minor units
                  </span>
                </span>
                <Lifecycle status={service.status} />
              </button>
            ))
          ) : (
            <p className="p-5 text-sm text-muted-foreground">
              Create the first Service customers will be able to book.
            </p>
          )}
        </div>
        <ServiceEditor
          key={selected?.id ?? 'new'}
          catalog={catalog}
          service={selected}
          onSaved={setSelectedId}
        />
      </div>
    </CatalogShell>
  )
}

function ServiceEditor({
  catalog,
  service,
  onSaved
}: {
  readonly catalog: MerchantCatalogSnapshot
  readonly service: ServiceRecord | null
  readonly onSaved: (id: string) => void
}) {
  const router = useRouter()
  const [step, setStep] = useState<'details' | 'providers'>('details')
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
    <div className="min-w-0">
      <div className="grid grid-cols-2 border-b bg-muted p-1">
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
          className="grid gap-4 p-5"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            setPending(true)
            setMessage(null)
            void saveMerchantService({
              data: {
                ...(service ? { id: service.id } : {}),
                name: formValue(form, 'name'),
                description: formValue(form, 'description') || null,
                category: formValue(form, 'category') || null,
                durationMinutes: Number(formValue(form, 'durationMinutes')),
                priceMinor: Number(formValue(form, 'priceMinor')),
                currency: formValue(form, 'currency').toUpperCase(),
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
            {service ? 'Edit Service details' : 'Create Service'}
          </p>
          <Field label="Name" name="name" defaultValue={service?.name} required />
          <label className="grid gap-1.5 text-sm">
            Display description{' '}
            <span className="text-xs text-muted-foreground">Optional</span>
            <textarea
              name="description"
              defaultValue={service?.description ?? ''}
              maxLength={300}
              className="min-h-24 rounded-md border bg-background px-3 py-2"
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
              label="Price (minor units)"
              name="priceMinor"
              type="number"
              min={1}
              defaultValue={service?.priceMinor ?? 5000}
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Currency"
              name="currency"
              defaultValue={service?.currency ?? 'RON'}
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
            className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
          >
            {pending
              ? 'Saving…'
              : service
                ? 'Save and continue'
                : 'Create and continue'}
          </button>
        </form>
      ) : service ? (
        <div className="p-5">
          <p className="text-sm font-semibold">Provider eligibility</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Eligibility is stored explicitly. Default status and Merchant membership do
            not assign a Provider.
          </p>
          <div className="mt-5 grid gap-2">
            {choices.map((choice) => (
              <label
                key={choice.id}
                className="flex items-center gap-3 rounded-md border p-3 text-sm font-medium"
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
            className="mt-5 h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
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
      className={`h-9 rounded-md text-sm font-medium ${active ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
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
      <input className="h-9 rounded-md border bg-background px-3" {...props} />
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
      <select className="h-9 rounded-md border bg-background px-3" {...props}>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>
    </label>
  )
}

function Lifecycle({ status }: { readonly status: 'active' | 'inactive' }) {
  return (
    <span
      className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-secondary text-muted-foreground'}`}
    >
      {status}
    </span>
  )
}
