import { useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import type { ProviderRecord } from '@b2b-saas-starter/capabilities'
import { CatalogShell } from '@/components/catalog-shell.tsx'
import { formValue } from '@/lib/form-value.ts'
import {
  getMerchantCatalog,
  saveMerchantProvider,
  saveServiceEligibility
} from '@/lib/server/merchant-catalog.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/providers')({
  beforeLoad: async ({ location }) => requireMerchantSession(location.href),
  loader: () => getMerchantCatalog(),
  component: ProvidersPage
})

function ProvidersPage() {
  const catalog = Route.useLoaderData()
  const [selectedId, setSelectedId] = useState<string | null>(
    catalog.providers[0]?.id ?? null
  )
  const provider = catalog.providers.find((item) => item.id === selectedId) ?? null

  if (catalog.presentation === 'solo') {
    return (
      <CatalogShell
        catalog={catalog}
        title="Provider administration is hidden"
        description="Solo uses the persisted default Provider automatically, so there is no separate Provider setup to maintain."
      >
        <Link
          to="/services"
          className="mt-6 inline-flex rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
        >
          Configure services
        </Link>
      </CatalogShell>
    )
  }

  return (
    <CatalogShell
      catalog={catalog}
      title="Providers"
      description="Team Provider editing keeps the reduced Profile, Services, and Schedule vocabulary. Schedule rules arrive in the next configuration slice."
    >
      <div className="mt-8 grid overflow-hidden border bg-card lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="border-b p-3 lg:border-r lg:border-b-0">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="mb-3 w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            New provider
          </button>
          {catalog.providers.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              className={`mb-1 w-full rounded-md px-3 py-3 text-left ${provider?.id === item.id ? 'bg-accent' : 'hover:bg-muted'}`}
            >
              <span className="block truncate text-sm font-medium">
                {item.displayName}
              </span>
              <span className="mt-1 block text-xs capitalize text-muted-foreground">
                {item.isDefault ? 'Default provider' : item.status}
              </span>
            </button>
          ))}
        </aside>
        <ProviderEditor key={provider?.id ?? 'new'} provider={provider} />
      </div>
    </CatalogShell>
  )
}

function ProviderEditor({ provider }: { readonly provider: ProviderRecord | null }) {
  const catalog = Route.useLoaderData()
  const router = useRouter()
  const [tab, setTab] = useState<'profile' | 'services' | 'schedule'>('profile')
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const saveProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setMessage(null)
    void saveMerchantProvider({
      data: {
        ...(provider ? { id: provider.id } : {}),
        displayName: formValue(form, 'displayName'),
        status: formValue(form, 'status') as 'active' | 'inactive',
        isDefault: form.get('isDefault') === 'on'
      }
    })
      .then(() => {
        setMessage('Provider profile saved.')
        void router.invalidate()
      })
      .catch(() => setMessage('Check the Provider values and default designation.'))
      .finally(() => setPending(false))
  }

  const toggleService = (serviceId: string, selected: boolean) => {
    if (!provider) return
    const service = catalog.services.find((item) => item.id === serviceId)
    if (!service) return
    const ids = selected
      ? [...new Set([...service.eligibleProviderIds, provider.id])]
      : service.eligibleProviderIds.filter((id) => id !== provider.id)
    setPending(true)
    void saveServiceEligibility({ data: { serviceId, providerIds: ids } })
      .then(() => {
        setMessage('Provider services saved.')
        void router.invalidate()
      })
      .catch(() => setMessage('Provider services could not be saved.'))
      .finally(() => setPending(false))
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">{provider?.displayName ?? 'Create provider'}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {provider?.isDefault ? 'Default provider' : 'Team provider'}
          </p>
        </div>
        <div className="flex rounded-md bg-secondary p-1">
          {(['profile', 'services', 'schedule'] as const).map((item) => (
            <button
              key={item}
              type="button"
              disabled={!provider && item !== 'profile'}
              onClick={() => setTab(item)}
              className={`h-9 rounded-md px-3 text-xs font-medium capitalize ${tab === item ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      {tab === 'profile' ? (
        <form className="grid gap-4 p-5" onSubmit={saveProfile}>
          <label className="grid gap-1.5 text-sm">
            Display name
            <input
              name="displayName"
              defaultValue={provider?.displayName}
              minLength={2}
              maxLength={80}
              required
              className="h-9 rounded-md border bg-card px-3"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            Lifecycle
            <select
              name="status"
              defaultValue={provider?.status ?? 'active'}
              className="h-9 rounded-md border bg-card px-3"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label className="flex items-center gap-3 rounded-md border p-3 text-sm">
            <input
              name="isDefault"
              type="checkbox"
              defaultChecked={provider?.isDefault ?? false}
            />
            Use as the default Provider
          </label>
          <button
            type="submit"
            disabled={pending}
            className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
          >
            {pending ? 'Saving…' : provider ? 'Save profile' : 'Create provider'}
          </button>
        </form>
      ) : null}
      {tab === 'services' && provider ? (
        <div className="p-5">
          <p className="text-sm font-semibold">Eligible services</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            These switches update the same explicit associations used by Service
            editing.
          </p>
          <div className="mt-5 grid gap-2">
            {catalog.services.map((service) => (
              <label
                key={service.id}
                className="flex items-center justify-between rounded-md border p-3 text-sm font-medium"
              >
                {service.name}
                <input
                  type="checkbox"
                  disabled={pending}
                  checked={service.eligibleProviderIds.includes(provider.id)}
                  onChange={(event) => toggleService(service.id, event.target.checked)}
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {tab === 'schedule' && provider ? (
        <div className="p-5">
          <p className="text-sm font-semibold">Schedule</p>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Configure recurring weekly hours in the Merchant timezone and inspect
            derived Availability.
          </p>
          <Link
            to="/availability"
            className="mt-4 inline-flex rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Configure schedule
          </Link>
        </div>
      ) : null}
      {message ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground">{message}</p>
      ) : null}
    </div>
  )
}
