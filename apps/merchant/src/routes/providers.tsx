import { useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import type { ProviderRecord } from '@b2b-saas-starter/capabilities/merchant-catalog'
import { MerchantShell } from '@/components/merchant-shell/index.ts'
import { mobileSheetNavigationState } from '@/components/merchant-shell/mobile/mobile-sheet-gesture.ts'
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
      <MerchantShell
        section={{ kind: 'catalog', presentation: catalog.presentation }}
        title="Provider administration is hidden"
        description="Solo uses the persisted default Provider automatically, so there is no separate Provider setup to maintain."
      >
        <Link
          to="/services"
          replace
          viewTransition={false}
          state={mobileSheetNavigationState}
          className="mt-2 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground md:mt-6 md:rounded-md"
        >
          Configure services
        </Link>
      </MerchantShell>
    )
  }

  return (
    <MerchantShell
      section={{ kind: 'catalog', presentation: catalog.presentation }}
      title="Providers"
      description="Team Provider editing keeps the reduced Profile, Services, and Schedule vocabulary. Schedule rules arrive in the next configuration slice."
    >
      <div className="mt-2 grid gap-3 md:mt-8 md:gap-0 md:overflow-hidden md:border md:bg-card lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="overflow-hidden rounded-2xl border bg-muted/30 p-2 md:rounded-none md:border-0 md:border-b md:bg-transparent md:p-3 lg:border-r lg:border-b-0">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="mb-2 h-10 w-full rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground md:mb-3 md:h-auto md:rounded-md md:py-2"
          >
            New provider
          </button>
          {catalog.providers.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              className={`mb-1 min-h-14 w-full rounded-xl px-3 py-2 text-left active:bg-muted/70 md:rounded-md md:py-3 ${provider?.id === item.id ? 'bg-accent' : 'md:hover:bg-muted'}`}
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
    </MerchantShell>
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
    <div className="min-w-0 overflow-hidden rounded-2xl border bg-muted/20 md:rounded-none md:border-0 md:bg-transparent">
      <div className="flex flex-col gap-3 border-b border-border/70 p-4 md:gap-4 md:p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">{provider?.displayName ?? 'Create provider'}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {provider?.isDefault ? 'Default provider' : 'Team provider'}
          </p>
        </div>
        <div className="flex rounded-xl bg-secondary p-1 md:rounded-md">
          {(['profile', 'services', 'schedule'] as const).map((item) => (
            <button
              key={item}
              type="button"
              disabled={!provider && item !== 'profile'}
              onClick={() => setTab(item)}
              className={`h-9 flex-1 rounded-lg px-3 text-xs font-medium capitalize md:flex-none md:rounded-md ${tab === item ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      {tab === 'profile' ? (
        <form className="grid gap-3 p-4 md:gap-4 md:p-5" onSubmit={saveProfile}>
          <label className="grid gap-1.5 text-sm">
            Display name
            <input
              name="displayName"
              defaultValue={provider?.displayName}
              minLength={2}
              maxLength={80}
              required
              className="h-10 rounded-xl border bg-card px-3 md:h-9 md:rounded-md"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            Lifecycle
            <select
              name="status"
              defaultValue={provider?.status ?? 'active'}
              className="h-10 rounded-xl border bg-card px-3 md:h-9 md:rounded-md"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label className="flex min-h-12 items-center gap-3 rounded-xl border p-3 text-sm md:rounded-md">
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
            className="h-10 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground md:h-9 md:rounded-md"
          >
            {pending ? 'Saving…' : provider ? 'Save profile' : 'Create provider'}
          </button>
        </form>
      ) : null}
      {tab === 'services' && provider ? (
        <div className="p-4 md:p-5">
          <p className="text-sm font-semibold">Eligible services</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            These switches update the same explicit associations used by Service
            editing.
          </p>
          <div className="mt-5 grid gap-2">
            {catalog.services.map((service) => (
              <label
                key={service.id}
                className="flex min-h-12 items-center justify-between rounded-xl border p-3 text-sm font-medium md:rounded-md"
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
        <div className="p-4 md:p-5">
          <p className="text-sm font-semibold">Schedule</p>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Configure recurring weekly hours in the Merchant timezone and inspect
            derived Availability.
          </p>
          <Link
            to="/availability"
            replace
            viewTransition={false}
            state={mobileSheetNavigationState}
            className="mt-4 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground md:h-auto md:rounded-md md:px-3 md:py-2"
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
