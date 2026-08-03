import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import type {
  MerchantCatalogSnapshot,
  ServiceRecord
} from '@b2b-saas-starter/capabilities/merchant-catalog'
import { serviceProviderChoices } from '@/lib/catalog-workflow.ts'
import { formValue } from '@/lib/form-value.ts'
import {
  merchantPriceInputStep,
  merchantPriceInputValue,
  merchantPriceMinorFromMajor
} from '@/lib/merchant-money.ts'
import {
  saveMerchantService,
  saveServiceEligibility
} from '@/lib/server/merchant-catalog.ts'
import { ServiceField, ServiceSelectField } from './service-form-controls.tsx'
import { ServiceStepButton } from './service-step-button.tsx'

export function ServiceEditor({
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

  const finish = async (text: string) => {
    setMessage(text)
    setPending(false)
    try {
      await router.invalidate()
    } catch {
      setMessage(`${text} Refresh the page to see the latest saved values.`)
    }
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border bg-muted/20 md:rounded-none md:border-0 md:bg-transparent">
      <div className="grid grid-cols-2 border-b border-border/70 bg-muted p-1">
        <ServiceStepButton
          active={step === 'details'}
          onClick={() => setStep('details')}
        >
          1 · Details
        </ServiceStepButton>
        <ServiceStepButton
          active={step === 'providers'}
          disabled={!service}
          onClick={() => setStep('providers')}
        >
          2 · Providers
        </ServiceStepButton>
      </div>
      {step === 'details' ? (
        <form
          className="grid gap-3 p-4 md:gap-4 md:p-5"
          action={async (form) => {
            const currency = formValue(form, 'currency').toUpperCase()
            setPending(true)
            setMessage(null)
            try {
              const saved = await saveMerchantService({
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
              onSaved(saved.id)
              setStep('providers')
              await finish('Service details saved.')
            } catch {
              await finish('Check the Service values and try again.')
            }
          }}
        >
          <p className="text-sm font-semibold">
            {service ? 'Edit service details' : 'Create service'}
          </p>
          <ServiceField
            label="Name"
            name="name"
            defaultValue={service?.name}
            required
          />
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
          <ServiceField
            label="Category (optional)"
            name="category"
            defaultValue={service?.category ?? ''}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <ServiceField
              label="Duration (minutes)"
              name="durationMinutes"
              type="number"
              min={1}
              defaultValue={service?.durationMinutes ?? 30}
              required
            />
            <ServiceField
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
            <ServiceField
              label="Currency"
              name="currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              minLength={3}
              maxLength={3}
              required
            />
            <ServiceSelectField
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
            onClick={async () => {
              setPending(true)
              try {
                await saveServiceEligibility({
                  data: { serviceId: service.id, providerIds: [...providerIds] }
                })
                await finish('Provider eligibility saved.')
              } catch {
                await finish('Eligibility could not be saved.')
              }
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
