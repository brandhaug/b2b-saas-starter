// PROTOTYPE — three variants of the minimum Merchant App surface, switchable via
// `?variant=`, on the throwaway `/prototype/minimum-merchant-surface` route.
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getMerchantOnboardingStatus } from '@/lib/server/merchant-onboarding.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleDollarSignIcon,
  Clock3Icon,
  EyeIcon,
  Globe2Icon,
  LayoutDashboardIcon,
  MapPinIcon,
  PlusIcon,
  ScissorsIcon,
  SettingsIcon,
  StoreIcon,
  UserRoundIcon,
  UsersIcon
} from 'lucide-react'

type VariantKey = 'A' | 'B' | 'C'

type PrototypeSearch = {
  readonly variant: VariantKey
  readonly screen: string
}

type Service = {
  readonly id: string
  readonly name: string
  readonly durationMinutes: number
  readonly priceMinor: number
  readonly status: 'active' | 'inactive'
  readonly providerIds: ReadonlyArray<string>
}

type Provider = {
  readonly id: string
  readonly displayName: string
  readonly isDefault: boolean
  readonly status: 'active' | 'inactive'
}

type ScheduleRule = {
  readonly providerId: string
  readonly day: string
  readonly enabled: boolean
  readonly start: string
  readonly end: string
}

type Appointment = {
  readonly id: string
  readonly startsAt: string
  readonly customer: {
    readonly name: string
    readonly email: string
    readonly phone: string | null
  }
  readonly providerName: string
  readonly providerPreference: 'specific' | 'any'
  readonly serviceNames: ReadonlyArray<string>
  readonly checkoutChoice: 'pay_in_person'
  readonly totalMinor: number
  readonly status: 'scheduled' | 'completed'
}

type PrototypeState = {
  readonly merchant: {
    readonly publicName: string
    readonly slug: string
    readonly timeZone: string
    readonly currency: 'USD'
    readonly plan: 'solo' | 'team'
    readonly publicPageStatus: 'published' | 'unpublished'
  }
  readonly services: ReadonlyArray<Service>
  readonly providers: ReadonlyArray<Provider>
  readonly scheduleRules: ReadonlyArray<ScheduleRule>
  readonly checkoutChoices: ReadonlyArray<'pay_in_person'>
  readonly appointments: ReadonlyArray<Appointment>
}

type PrototypeActions = {
  readonly setMerchantName: (value: string) => void
  readonly setMerchantSlug: (value: string) => void
  readonly togglePublished: () => void
  readonly addService: () => void
  readonly updateService: (id: string, patch: Partial<Service>) => void
  readonly addProvider: () => void
  readonly updateProvider: (id: string, patch: Partial<Provider>) => void
  readonly toggleServiceProvider: (serviceId: string, providerId: string) => void
  readonly toggleScheduleDay: (providerId: string, day: string) => void
  readonly updateScheduleTime: (
    providerId: string,
    day: string,
    field: 'start' | 'end',
    value: string
  ) => void
}

type VariantProps = {
  readonly state: PrototypeState
  readonly actions: PrototypeActions
  readonly screen: string
  readonly setScreen: (screen: string) => void
}

const defaultScreens: Record<VariantKey, string> = {
  A: 'launch',
  B: 'appointments',
  C: 'public-page'
}

const variantNames: Record<VariantKey, string> = {
  A: 'Guided launch',
  B: 'Source-reduced rail',
  C: 'Booking chain'
}

const moneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
})

const appointmentDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/New_York'
})

const initialState: PrototypeState = {
  merchant: {
    publicName: 'Northline Studio',
    slug: 'northline-studio',
    timeZone: 'America/New_York',
    currency: 'USD',
    plan: 'team',
    publicPageStatus: 'published'
  },
  services: [
    {
      id: 'svc_cut',
      name: 'Signature cut',
      durationMinutes: 45,
      priceMinor: 5200,
      status: 'active',
      providerIds: ['prv_mara', 'prv_eli']
    },
    {
      id: 'svc_beard',
      name: 'Beard detail',
      durationMinutes: 20,
      priceMinor: 2400,
      status: 'active',
      providerIds: ['prv_eli']
    },
    {
      id: 'svc_reset',
      name: 'Cut + beard reset',
      durationMinutes: 65,
      priceMinor: 7200,
      status: 'active',
      providerIds: ['prv_mara']
    }
  ],
  providers: [
    {
      id: 'prv_mara',
      displayName: 'Mara Ellis',
      isDefault: true,
      status: 'active'
    },
    {
      id: 'prv_eli',
      displayName: 'Eli Rhodes',
      isDefault: false,
      status: 'active'
    }
  ],
  scheduleRules: [
    {
      providerId: 'prv_mara',
      day: 'Monday',
      enabled: true,
      start: '09:00',
      end: '17:00'
    },
    {
      providerId: 'prv_mara',
      day: 'Tuesday',
      enabled: true,
      start: '09:00',
      end: '17:00'
    },
    {
      providerId: 'prv_mara',
      day: 'Wednesday',
      enabled: true,
      start: '11:00',
      end: '19:00'
    },
    {
      providerId: 'prv_eli',
      day: 'Thursday',
      enabled: true,
      start: '10:00',
      end: '18:00'
    },
    {
      providerId: 'prv_eli',
      day: 'Friday',
      enabled: true,
      start: '10:00',
      end: '18:00'
    }
  ],
  checkoutChoices: ['pay_in_person'],
  appointments: [
    {
      id: 'apt_7F2K9',
      startsAt: '2026-07-12T14:00:00-04:00',
      customer: {
        name: 'Avery Morgan',
        email: 'avery@example.com',
        phone: '+1 212 555 0137'
      },
      providerName: 'Mara Ellis',
      providerPreference: 'specific',
      serviceNames: ['Signature cut'],
      checkoutChoice: 'pay_in_person',
      totalMinor: 5200,
      status: 'scheduled'
    },
    {
      id: 'apt_4M8Q1',
      startsAt: '2026-07-03T11:00:00-04:00',
      customer: {
        name: 'Jordan Lee',
        email: 'jordan@example.com',
        phone: null
      },
      providerName: 'Eli Rhodes',
      providerPreference: 'any',
      serviceNames: ['Signature cut', 'Beard detail'],
      checkoutChoice: 'pay_in_person',
      totalMinor: 7600,
      status: 'completed'
    }
  ]
}

function decodeSearch(search: Record<string, unknown>): PrototypeSearch {
  const variant =
    search.variant === 'B' || search.variant === 'C' ? search.variant : 'A'
  return {
    variant,
    screen:
      typeof search.screen === 'string' && search.screen.length > 0
        ? search.screen
        : defaultScreens[variant]
  }
}

export const Route = createFileRoute('/prototype/minimum-merchant-surface')({
  validateSearch: decodeSearch,
  beforeLoad: async ({ location }) => {
    await requireMerchantSession(location.href)
  },
  loader: async () => {
    const status = await getMerchantOnboardingStatus()
    if (status.state !== 'merchant') throw redirect({ to: '/' })
    return status.merchant
  },
  component: MinimumMerchantSurfacePrototype
})

function MinimumMerchantSurfacePrototype() {
  const { variant, screen } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [state, setState] = useState<PrototypeState>(initialState)

  const actions: PrototypeActions = {
    setMerchantName: (publicName) =>
      setState((current) => ({
        ...current,
        merchant: { ...current.merchant, publicName }
      })),
    setMerchantSlug: (slug) =>
      setState((current) => ({
        ...current,
        merchant: { ...current.merchant, slug }
      })),
    togglePublished: () =>
      setState((current) => ({
        ...current,
        merchant: {
          ...current.merchant,
          publicPageStatus:
            current.merchant.publicPageStatus === 'published'
              ? 'unpublished'
              : 'published'
        }
      })),
    addService: () =>
      setState((current) => ({
        ...current,
        services: [
          ...current.services,
          {
            id: `svc_prototype_${current.services.length + 1}`,
            name: 'New service',
            durationMinutes: 30,
            priceMinor: 3000,
            status: 'active',
            providerIds: current.providers[0] ? [current.providers[0].id] : []
          }
        ]
      })),
    updateService: (id, patch) =>
      setState((current) => ({
        ...current,
        services: current.services.map((service) =>
          service.id === id ? { ...service, ...patch } : service
        )
      })),
    addProvider: () =>
      setState((current) => {
        const id = `prv_prototype_${current.providers.length + 1}`
        return {
          ...current,
          providers: [
            ...current.providers,
            {
              id,
              displayName: `New provider ${current.providers.length + 1}`,
              isDefault: false,
              status: 'active'
            }
          ],
          scheduleRules: [
            ...current.scheduleRules,
            {
              providerId: id,
              day: 'Monday',
              enabled: true,
              start: '09:00',
              end: '17:00'
            }
          ]
        }
      }),
    updateProvider: (id, patch) =>
      setState((current) => ({
        ...current,
        providers: current.providers.map((provider) =>
          provider.id === id ? { ...provider, ...patch } : provider
        )
      })),
    toggleServiceProvider: (serviceId, providerId) =>
      setState((current) => ({
        ...current,
        services: current.services.map((service) => {
          if (service.id !== serviceId) return service
          const isAssigned = service.providerIds.includes(providerId)
          return {
            ...service,
            providerIds: isAssigned
              ? service.providerIds.filter((id) => id !== providerId)
              : [...service.providerIds, providerId]
          }
        })
      })),
    toggleScheduleDay: (providerId, day) =>
      setState((current) => ({
        ...current,
        scheduleRules: current.scheduleRules.map((rule) =>
          rule.providerId === providerId && rule.day === day
            ? { ...rule, enabled: !rule.enabled }
            : rule
        )
      })),
    updateScheduleTime: (providerId, day, field, value) =>
      setState((current) => ({
        ...current,
        scheduleRules: current.scheduleRules.map((rule) =>
          rule.providerId === providerId && rule.day === day
            ? { ...rule, [field]: value }
            : rule
        )
      }))
  }

  const setScreen = (nextScreen: string) => {
    void navigate({ search: { variant, screen: nextScreen }, replace: true })
  }

  const setVariant = (nextVariant: VariantKey) => {
    void navigate({
      search: {
        variant: nextVariant,
        screen: defaultScreens[nextVariant]
      },
      replace: true
    })
  }

  return (
    <>
      {variant === 'A' ? (
        <VariantA
          state={state}
          actions={actions}
          screen={screen}
          setScreen={setScreen}
        />
      ) : null}
      {variant === 'B' ? (
        <VariantB
          state={state}
          actions={actions}
          screen={screen}
          setScreen={setScreen}
        />
      ) : null}
      {variant === 'C' ? (
        <VariantC
          state={state}
          actions={actions}
          screen={screen}
          setScreen={setScreen}
        />
      ) : null}
      {import.meta.env.DEV ? (
        <PrototypeSwitcher current={variant} setVariant={setVariant} />
      ) : null}
    </>
  )
}

function VariantA({ state, actions, screen, setScreen }: VariantProps) {
  const readiness = getReadiness(state)
  const steps = [
    {
      key: 'launch',
      label: 'Launch overview',
      route: 'overview',
      icon: LayoutDashboardIcon
    },
    {
      key: 'business',
      label: 'Business & page',
      route: '/settings/public-page',
      icon: StoreIcon
    },
    { key: 'services', label: 'Services', route: '/services', icon: ScissorsIcon },
    {
      key: 'providers',
      label: 'Providers',
      route: '/settings/providers',
      icon: UsersIcon
    },
    { key: 'hours', label: 'Working hours', route: '/availability', icon: Clock3Icon },
    {
      key: 'checkout',
      label: 'Checkout',
      route: '/settings/checkout',
      icon: CircleDollarSignIcon
    },
    {
      key: 'appointments',
      label: 'Review bookings',
      route: '/appointments',
      icon: CalendarDaysIcon
    }
  ] as const
  const activeScreen = steps.some((step) => step.key === screen) ? screen : 'launch'

  return (
    <div className="min-h-dvh bg-background pb-28">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark />
            <span className="hidden text-sm text-muted-foreground sm:inline">/</span>
            <span className="truncate text-sm font-medium">
              {state.merchant.publicName}
            </span>
            <StatusBadge
              tone={
                state.merchant.publicPageStatus === 'published' ? 'good' : 'neutral'
              }
            >
              {state.merchant.publicPageStatus}
            </StatusBadge>
          </div>
          <Button variant="secondary" onClick={() => setScreen('business')}>
            <EyeIcon className="size-4" />
            <span className="hidden sm:inline">View public page</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:px-8">
        <aside>
          <div className="border bg-card p-4 lg:sticky lg:top-20">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Booking setup</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {readiness.complete}/{readiness.total} ready
                </p>
              </div>
              <span className="font-mono text-sm">{readiness.percent}%</span>
            </div>
            <div className="mb-5 h-1 bg-secondary">
              <div
                className="h-full bg-primary"
                style={{ width: `${readiness.percent}%` }}
              />
            </div>
            <nav className="grid gap-1" aria-label="Guided setup screens">
              {steps.map((step) => (
                <button
                  key={step.key}
                  type="button"
                  onClick={() => setScreen(step.key)}
                  className={`flex min-h-10 items-center gap-3 rounded-md px-3 text-left text-sm ${
                    activeScreen === step.key
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <step.icon className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{step.label}</span>
                  {activeScreen === step.key ? (
                    <ChevronRightIcon className="size-4" />
                  ) : null}
                </button>
              ))}
            </nav>
            <div className="mt-5 border-t pt-4">
              <p className="text-xs leading-5 text-muted-foreground">
                Guided launch treats the setup path—not resource navigation—as the
                product.
              </p>
            </div>
          </div>
        </aside>

        <section className="min-w-0">
          <GuidedContent
            screen={activeScreen}
            state={state}
            actions={actions}
            setScreen={setScreen}
          />
          <PrototypeStatePanel state={state} />
        </section>
      </main>
    </div>
  )
}

function GuidedContent({ screen, state, actions, setScreen }: VariantProps) {
  const readiness = getReadiness(state)
  const firstService = state.services[0]
  const firstProvider = state.providers[0]

  if (screen === 'launch') {
    return (
      <div className="prototype-enter">
        <PageHeading
          eyebrow="Variant A · Guided launch"
          title="Make the business bookable"
          description="One ordered setup path extracts only the booking-critical fields from the legacy Shop form, Service assignment flow, and Staff tabs. Operations begin only after launch."
          action={
            <Button onClick={actions.togglePublished}>
              <Globe2Icon className="size-4" />
              {state.merchant.publicPageStatus === 'published'
                ? 'Unpublish'
                : 'Publish page'}
            </Button>
          }
        />
        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="border bg-card">
            <div className="flex items-center justify-between border-b p-5">
              <div>
                <h2 className="font-semibold">Ready to accept bookings</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Publication is derived from these five inputs.
                </p>
              </div>
              <span className="font-mono text-sm">
                {readiness.complete}/{readiness.total}
              </span>
            </div>
            <div className="divide-y">
              {readiness.checks.map((check) => (
                <button
                  key={check.label}
                  type="button"
                  onClick={() => setScreen(check.screen)}
                  className="flex w-full items-center gap-4 p-5 text-left hover:bg-muted"
                >
                  <span
                    className={`grid size-7 shrink-0 place-items-center rounded-full ${check.ready ? 'bg-primary text-primary-foreground' : 'border bg-background text-muted-foreground'}`}
                  >
                    {check.ready ? (
                      <CheckIcon className="size-4" />
                    ) : (
                      <span className="size-1.5 rounded-full bg-current" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{check.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {check.detail}
                    </span>
                  </span>
                  <ChevronRightIcon className="size-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-6">
            <div className="border bg-muted p-5">
              <p className="text-sm font-medium">Smallest viable model</p>
              <dl className="mt-4 grid gap-3 text-sm">
                <Fact
                  label="Persisted"
                  value="Merchant, services, providers, hours, checkout"
                />
                <Fact label="Derived" value="Readiness, time slots, customers" />
                <Fact label="Inspect" value="Appointment snapshots" />
              </dl>
            </div>
            <DeferredStructure />
            <SourceReductionNote />
          </div>
        </div>
      </div>
    )
  }

  if (screen === 'business') {
    return (
      <div className="prototype-enter">
        <PageHeading
          eyebrow="Step 1 · Business & public page"
          title="One public identity"
          description="The Merchant owns the name and booking slug directly. The first slice has no Shop or Brand record."
        />
        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <Panel
            title="Customer-facing details"
            description="Saves are live immediately while the page is published."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Public name">
                <Input
                  value={state.merchant.publicName}
                  onChange={actions.setMerchantName}
                />
              </Field>
              <Field label="Booking URL">
                <Input
                  value={state.merchant.slug}
                  onChange={actions.setMerchantSlug}
                  prefix="www.example.com/"
                  mono
                />
              </Field>
              <ReadOnlyField label="Time zone" value={state.merchant.timeZone} />
              <ReadOnlyField label="Currency" value={state.merchant.currency} />
            </div>
            <div className="mt-6 flex justify-end">
              <Button>Save public page</Button>
            </div>
          </Panel>
          <DeferredStructure />
        </div>
      </div>
    )
  }

  if (screen === 'services') {
    return (
      <div className="prototype-enter">
        <PageHeading
          eyebrow="Step 2 · Services"
          title="Define what customers can book"
          description="Duration, price, lifecycle, and provider eligibility are the only first-slice service inputs."
          action={
            <Button onClick={actions.addService}>
              <PlusIcon className="size-4" />
              Add service
            </Button>
          }
        />
        <div className="mt-8 border bg-card">
          <div className="grid grid-cols-[minmax(0,1fr)_6rem_7rem] gap-4 border-b bg-muted px-5 py-3 text-xs font-medium text-muted-foreground sm:grid-cols-[minmax(0,1fr)_7rem_8rem_8rem]">
            <span>Service</span>
            <span>Duration</span>
            <span>Price</span>
            <span className="hidden sm:block">Providers</span>
          </div>
          <div className="divide-y">
            {state.services.map((service) => (
              <div
                key={service.id}
                className="grid grid-cols-[minmax(0,1fr)_6rem_7rem] items-center gap-4 px-5 py-4 text-sm sm:grid-cols-[minmax(0,1fr)_7rem_8rem_8rem]"
              >
                <div className="min-w-0">
                  {service.id === firstService?.id ? (
                    <input
                      aria-label="Service name"
                      className="h-9 w-full rounded-md border bg-card px-3"
                      value={service.name}
                      onChange={(event) =>
                        actions.updateService(service.id, { name: event.target.value })
                      }
                    />
                  ) : (
                    <span className="font-medium">{service.name}</span>
                  )}
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {service.id}
                  </p>
                </div>
                <span>{service.durationMinutes} min</span>
                <span className="font-mono">{formatMoney(service.priceMinor)}</span>
                <span className="hidden text-muted-foreground sm:block">
                  {service.providerIds.length} eligible
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (screen === 'providers') {
    return (
      <div className="prototype-enter">
        <PageHeading
          eyebrow="Step 3 · Providers"
          title="Who performs the work?"
          description="Solo merchants keep the default provider but hide this screen. Team merchants expose it only when assignments matter."
          action={
            <Button onClick={actions.addProvider}>
              <PlusIcon className="size-4" />
              Add provider
            </Button>
          }
        />
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {state.providers.map((provider) => (
            <div key={provider.id} className="border bg-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="grid size-10 place-items-center rounded-full bg-secondary">
                  <UserRoundIcon className="size-5" />
                </div>
                <StatusBadge tone="good">{provider.status}</StatusBadge>
              </div>
              <h2 className="mt-5 font-semibold">{provider.displayName}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {provider.isDefault ? 'Default provider' : 'Team provider'}
              </p>
              <p className="mt-5 font-mono text-xs text-muted-foreground">
                {provider.id}
              </p>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (screen === 'hours') {
    return (
      <div className="prototype-enter">
        <PageHeading
          eyebrow="Step 4 · Availability"
          title="Set recurring working hours"
          description="The merchant edits Schedule Rules. Customer-visible time slots are derived, never stored here."
        />
        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <ScheduleEditor state={state} actions={actions} />
          <DerivedAvailability state={state} />
        </div>
      </div>
    )
  }

  if (screen === 'checkout') {
    return (
      <div className="prototype-enter">
        <PageHeading
          eyebrow="Step 5 · Checkout"
          title="Choose how customers confirm"
          description="The first slice can launch provider-light with Pay in person. Payment readiness can add Pay now later."
        />
        <div className="mt-8 max-w-2xl border bg-card p-6">
          <div className="flex items-start gap-4">
            <span className="grid size-9 place-items-center rounded-md bg-primary text-primary-foreground">
              <CheckIcon className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold">Pay in person</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Create the Appointment at confirmation without requiring a payment
                provider.
              </p>
            </div>
          </div>
          <div className="mt-6 border-t pt-5 text-sm text-muted-foreground">
            Pay now is disabled until a payment provider is configured and the merchant
            enables it.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="prototype-enter">
      <PageHeading
        eyebrow="Operations · Appointments"
        title="Review confirmed bookings"
        description="Appointments are created by the Booking App. The merchant inspects immutable service, provider, customer, time, and checkout snapshots here."
      />
      <AppointmentList state={state} />
      {firstProvider ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Default provider: {firstProvider.displayName}
        </p>
      ) : null}
    </div>
  )
}

function VariantB({ state, actions, screen, setScreen }: VariantProps) {
  const routes = [
    {
      key: 'appointments',
      label: 'Appointments',
      path: '/appointments',
      icon: CalendarDaysIcon
    },
    { key: 'customers', label: 'Customers', path: '/customers', icon: UsersIcon },
    {
      key: 'providers',
      label: 'Providers',
      path: '/providers',
      icon: UserRoundIcon
    },
    { key: 'services', label: 'Services', path: '/services', icon: ScissorsIcon },
    {
      key: 'availability',
      label: 'Availability',
      path: '/availability',
      icon: Clock3Icon
    },
    { key: 'settings', label: 'Settings', path: '/settings', icon: SettingsIcon }
  ] as const
  const activeScreen = routes.some((route) => route.key === screen)
    ? screen
    : 'appointments'

  return (
    <div className="min-h-dvh bg-muted pb-24 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="border-b bg-card lg:sticky lg:top-0 lg:h-dvh lg:border-r lg:border-b-0">
        <div className="flex h-14 items-center gap-3 border-b px-4">
          <BrandMark />
          <span className="text-sm font-semibold">Merchant</span>
        </div>
        <div className="p-3">
          <button
            type="button"
            onClick={() => setScreen('settings')}
            className="mb-4 flex w-full items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-muted"
          >
            <span className="grid size-8 place-items-center rounded-md bg-foreground text-xs font-semibold text-background">
              NS
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {state.merchant.publicName}
              </span>
              <span className="block text-xs text-muted-foreground">Team plan</span>
            </span>
            <ChevronRightIcon className="size-4 text-muted-foreground" />
          </button>
          <nav
            className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1"
            aria-label="Merchant operations"
          >
            {routes.map((route) => (
              <button
                key={route.key}
                type="button"
                onClick={() => setScreen(route.key)}
                className={`flex min-h-10 items-center gap-3 rounded-md px-3 text-left text-sm ${activeScreen === route.key ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              >
                <route.icon className="size-4" />
                <span>{route.label}</span>
              </button>
            ))}
          </nav>
        </div>
        <div className="hidden border-t p-4 lg:absolute lg:inset-x-0 lg:bottom-0 lg:block">
          <p className="text-xs leading-5 text-muted-foreground">
            Source-reduced from the legacy app: appointments stay first, while deferred
            POS, reports, marketing, and staff-admin surfaces are removed.
          </p>
        </div>
      </aside>

      <section className="min-w-0">
        <header className="flex min-h-14 items-center justify-between border-b bg-background px-4 lg:px-8">
          <div className="min-w-0">
            <span className="font-mono text-xs text-muted-foreground">
              {routes.find((route) => route.key === activeScreen)?.path}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge tone="good">Published</StatusBadge>
            <Button variant="secondary">
              <EyeIcon className="size-4" />
              View public page
            </Button>
          </div>
        </header>
        <main className="p-4 lg:p-8">
          {activeScreen === 'appointments' ? (
            <div className="prototype-enter">
              <PageHeading
                eyebrow="Variant B · Source-reduced operations rail"
                title="Appointments"
                description="Like the legacy merchant app, the returning operator lands on a provider-by-provider day schedule. The first slice makes confirmed Appointments inspect-only."
              />
              <AppointmentWorkbench state={state} />
            </div>
          ) : null}
          {activeScreen === 'customers' ? (
            <div className="prototype-enter">
              <PageHeading
                eyebrow="Variant B · Source-reduced operations rail"
                title="Customers"
                description="The legacy Clients destination survives only as an appointment-derived directory—not a writable customer profile system."
              />
              <CustomerDirectory state={state} />
            </div>
          ) : null}
          {activeScreen === 'providers' ? (
            <div className="prototype-enter">
              <PageHeading
                eyebrow="Variant B · Source-reduced operations rail"
                title="Providers"
                description="The legacy Staff form's Profile, Services, and Schedule tabs remain. Notifications, permissions, payroll, and employment data are deferred."
                action={
                  <Button onClick={actions.addProvider}>
                    <PlusIcon className="size-4" />
                    Add provider
                  </Button>
                }
              />
              <ProviderWorkbench state={state} actions={actions} />
            </div>
          ) : null}
          {activeScreen === 'services' ? (
            <div className="prototype-enter">
              <PageHeading
                eyebrow="Variant B · Source-reduced operations rail"
                title="Services"
                description="The legacy two-step Details → Assign flow is retained because Provider eligibility is first-slice booking configuration. Location assignment, tax, and kiosk options are removed."
                action={
                  <Button onClick={actions.addService}>
                    <PlusIcon className="size-4" />
                    Create service
                  </Button>
                }
              />
              <ServiceWorkbench state={state} actions={actions} />
            </div>
          ) : null}
          {activeScreen === 'availability' ? (
            <div className="prototype-enter">
              <PageHeading
                eyebrow="Variant B · Source-reduced operations rail"
                title="Availability"
                description="The legacy Shop and Staff schedule editors become one Provider-focused route. Recurring Schedule Rules are persisted; customer Time Slots remain derived."
              />
              <ProviderAvailabilityWorkbench state={state} actions={actions} />
            </div>
          ) : null}
          {activeScreen === 'settings' ? (
            <div className="prototype-enter">
              <PageHeading
                eyebrow="Variant B · Source-reduced operations rail"
                title="Settings"
                description="The legacy Shop Details mega-form is reduced to Merchant identity, public page status, timezone, and checkout policy."
              />
              <div className="mt-8 grid gap-6 xl:grid-cols-2">
                <Panel
                  title="Public page"
                  description="Merchant-owned identity; no Shop row."
                >
                  <div className="grid gap-4">
                    <Field label="Public name">
                      <Input
                        value={state.merchant.publicName}
                        onChange={actions.setMerchantName}
                      />
                    </Field>
                    <Field label="Slug">
                      <Input
                        value={state.merchant.slug}
                        onChange={actions.setMerchantSlug}
                        mono
                      />
                    </Field>
                    <Button onClick={actions.togglePublished}>
                      {state.merchant.publicPageStatus === 'published'
                        ? 'Unpublish'
                        : 'Publish'}{' '}
                      page
                    </Button>
                  </div>
                </Panel>
                <Panel
                  title="Booking policy"
                  description="Translated from legacy booking-without-payment and any-barber options."
                >
                  <div className="flex items-center justify-between border-b pb-4">
                    <div>
                      <p className="text-sm font-medium">Provider preference</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Specific Provider and Any Provider
                      </p>
                    </div>
                    <StatusBadge tone="good">Team</StatusBadge>
                  </div>
                  <div className="pt-4">
                    <p className="text-sm font-medium">Checkout choice</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Pay in person enabled
                    </p>
                  </div>
                </Panel>
                <DeferredStructure />
                <SourceReductionNote />
              </div>
            </div>
          ) : null}
          <PrototypeStatePanel state={state} />
        </main>
      </section>
    </div>
  )
}

function ServiceWorkbench({
  state,
  actions
}: {
  readonly state: PrototypeState
  readonly actions: PrototypeActions
}) {
  const [step, setStep] = useState<'details' | 'eligibility'>('details')
  const selectedService = state.services[0]
  const assignedProviderIds = new Set(selectedService?.providerIds ?? [])

  return (
    <div className="mt-8 grid border bg-card xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 xl:border-r">
        <div className="grid grid-cols-[minmax(0,1fr)_6rem_7rem] border-b bg-muted px-4 py-3 text-xs font-medium text-muted-foreground sm:grid-cols-[minmax(0,1fr)_7rem_8rem_7rem]">
          <span>Name</span>
          <span>Duration</span>
          <span>Price</span>
          <span className="hidden sm:block">Status</span>
        </div>
        {state.services.map((service, index) => (
          <button
            key={service.id}
            type="button"
            className={`grid w-full grid-cols-[minmax(0,1fr)_6rem_7rem] items-center border-b px-4 py-4 text-left text-sm last:border-b-0 sm:grid-cols-[minmax(0,1fr)_7rem_8rem_7rem] ${index === 0 ? 'bg-accent' : 'hover:bg-muted'}`}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{service.name}</span>
              <span className="mt-1 block font-mono text-xs text-muted-foreground">
                {service.id}
              </span>
            </span>
            <span>{service.durationMinutes}m</span>
            <span className="font-mono">{formatMoney(service.priceMinor)}</span>
            <span className="hidden sm:block">
              <StatusBadge tone="good">{service.status}</StatusBadge>
            </span>
          </button>
        ))}
      </div>
      <div>
        <div className="grid grid-cols-2 border-b bg-muted p-1">
          <button
            type="button"
            onClick={() => setStep('details')}
            className={`h-9 rounded-md text-sm font-medium ${step === 'details' ? 'bg-card text-foreground' : 'text-muted-foreground'}`}
          >
            1 · Details
          </button>
          <button
            type="button"
            onClick={() => setStep('eligibility')}
            className={`h-9 rounded-md text-sm font-medium ${step === 'eligibility' ? 'bg-card text-foreground' : 'text-muted-foreground'}`}
          >
            2 · Providers
          </button>
        </div>
        <div className="p-5">
          {selectedService && step === 'details' ? (
            <div className="grid gap-4">
              <p className="text-sm font-semibold">Edit service details</p>
              <Field label="Name">
                <Input
                  value={selectedService.name}
                  onChange={(name) =>
                    actions.updateService(selectedService.id, { name })
                  }
                />
              </Field>
              <Field label="Duration (minutes)">
                <Input
                  type="number"
                  value={String(selectedService.durationMinutes)}
                  onChange={(value) =>
                    actions.updateService(selectedService.id, {
                      durationMinutes: Number(value) || 0
                    })
                  }
                  mono
                />
              </Field>
              <Field label="Price (minor units)">
                <Input
                  type="number"
                  value={String(selectedService.priceMinor)}
                  onChange={(value) =>
                    actions.updateService(selectedService.id, {
                      priceMinor: Number(value) || 0
                    })
                  }
                  mono
                />
              </Field>
              <Button onClick={() => setStep('eligibility')}>
                Continue to Providers
                <ArrowRightIcon className="size-4" />
              </Button>
            </div>
          ) : null}
          {selectedService && step === 'eligibility' ? (
            <div>
              <p className="text-sm font-semibold">Provider eligibility</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Reduced from the legacy assignment table: no Location row, per-provider
                price override, tax, kiosk, or prepayment override.
              </p>
              <div className="mt-5 grid gap-2">
                {state.providers.map((provider) => {
                  const assigned = assignedProviderIds.has(provider.id)
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() =>
                        actions.toggleServiceProvider(selectedService.id, provider.id)
                      }
                      className={`flex items-center gap-3 rounded-md border p-3 text-left ${assigned ? 'border-primary bg-accent' : 'bg-card'}`}
                    >
                      <span
                        className={`grid size-6 place-items-center rounded-md ${assigned ? 'bg-primary text-primary-foreground' : 'border'}`}
                      >
                        {assigned ? <CheckIcon className="size-4" /> : null}
                      </span>
                      <span className="min-w-0 flex-1 text-sm font-medium">
                        {provider.displayName}
                      </span>
                    </button>
                  )
                })}
              </div>
              <Button className="mt-5">Save eligibility</Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ProviderWorkbench({
  state,
  actions
}: {
  readonly state: PrototypeState
  readonly actions: PrototypeActions
}) {
  const [selectedProviderId, setSelectedProviderId] = useState(
    state.providers[0]?.id ?? ''
  )
  const [tab, setTab] = useState<'profile' | 'services' | 'schedule'>('profile')
  const provider =
    state.providers.find((item) => item.id === selectedProviderId) ?? state.providers[0]

  if (!provider) return <div className="mt-8 border bg-card p-6">No providers yet.</div>

  return (
    <div className="mt-8 grid border bg-card lg:grid-cols-[15rem_minmax(0,1fr)]">
      <div className="border-b p-3 lg:border-r lg:border-b-0">
        <p className="px-3 py-2 text-xs font-medium text-muted-foreground">
          Team providers
        </p>
        <div className="grid gap-1">
          {state.providers.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedProviderId(item.id)}
              className={`flex items-center gap-3 rounded-md px-3 py-3 text-left ${item.id === provider.id ? 'bg-accent' : 'hover:bg-muted'}`}
            >
              <span className="grid size-8 place-items-center rounded-full bg-secondary">
                <UserRoundIcon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {item.displayName}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {item.isDefault ? 'Default provider' : item.status}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-semibold">{provider.displayName}</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {provider.id}
            </p>
          </div>
          <div className="flex gap-1 rounded-md bg-secondary p-1">
            {(['profile', 'services', 'schedule'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTab(item)}
                className={`h-8 rounded-md px-3 text-xs font-medium capitalize ${tab === item ? 'bg-card text-foreground' : 'text-muted-foreground'}`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="p-5">
          {tab === 'profile' ? (
            <div className="max-w-xl">
              <Field label="Customer-facing display name">
                <Input
                  value={provider.displayName}
                  onChange={(displayName) =>
                    actions.updateProvider(provider.id, { displayName })
                  }
                />
              </Field>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <ReadOnlyField label="Lifecycle" value={provider.status} />
                <ReadOnlyField
                  label="Booking role"
                  value={provider.isDefault ? 'Default provider' : 'Team provider'}
                />
              </div>
              <p className="mt-5 text-xs leading-5 text-muted-foreground">
                Legacy email, phone, personnel ID, permissions, payroll, and login
                fields are intentionally absent from the first booking slice.
              </p>
            </div>
          ) : null}
          {tab === 'services' ? (
            <div className="grid gap-2">
              {state.services.map((service) => {
                const assigned = service.providerIds.includes(provider.id)
                return (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() =>
                      actions.toggleServiceProvider(service.id, provider.id)
                    }
                    className={`flex items-center justify-between gap-4 rounded-md border p-4 text-left ${assigned ? 'border-primary bg-accent' : 'bg-card'}`}
                  >
                    <span>
                      <span className="block text-sm font-medium">{service.name}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {service.durationMinutes} min ·{' '}
                        {formatMoney(service.priceMinor)}
                      </span>
                    </span>
                    <StatusBadge tone={assigned ? 'good' : 'neutral'}>
                      {assigned ? 'Eligible' : 'Not assigned'}
                    </StatusBadge>
                  </button>
                )
              })}
            </div>
          ) : null}
          {tab === 'schedule' ? (
            <ScheduleEditor state={state} actions={actions} providerId={provider.id} />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ProviderAvailabilityWorkbench({
  state,
  actions
}: {
  readonly state: PrototypeState
  readonly actions: PrototypeActions
}) {
  const [providerId, setProviderId] = useState(state.providers[0]?.id ?? '')
  const activeProvider =
    state.providers.find((provider) => provider.id === providerId) ?? state.providers[0]

  return (
    <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {state.providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              onClick={() => setProviderId(provider.id)}
              className={`h-9 shrink-0 rounded-md px-3 text-sm font-medium ${provider.id === activeProvider?.id ? 'bg-foreground text-background' : 'border bg-card'}`}
            >
              {provider.displayName}
            </button>
          ))}
        </div>
        <ScheduleEditor
          state={state}
          actions={actions}
          providerId={activeProvider?.id}
        />
      </div>
      <div className="space-y-4">
        <DerivedAvailability state={state} />
        <div className="border border-dashed bg-card p-4 text-xs leading-5 text-muted-foreground">
          Legacy days off, days on, future schedules, booking intervals, and
          cross-location conflicts are deferred. The first slice persists recurring
          weekly Provider hours only.
        </div>
      </div>
    </div>
  )
}

function AppointmentWorkbench({ state }: { readonly state: PrototypeState }) {
  const [selectedId, setSelectedId] = useState(state.appointments[0]?.id ?? '')
  const selected =
    state.appointments.find((appointment) => appointment.id === selectedId) ??
    state.appointments[0]
  const hours = ['9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM']

  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border bg-card p-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary">
            <ArrowLeftIcon className="size-4" />
            <span className="sr-only">Previous day</span>
          </Button>
          <p className="min-w-40 text-center text-sm font-medium">Sunday, July 12</p>
          <Button variant="secondary">
            <ArrowRightIcon className="size-4" />
            <span className="sr-only">Next day</span>
          </Button>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <StatusBadge tone="neutral">Day</StatusBadge>
          <span>{state.providers.length} Providers</span>
        </div>
      </div>
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="overflow-x-auto border bg-card">
          <div className="grid min-w-[36rem] grid-cols-[4rem_repeat(2,minmax(14rem,1fr))]">
            <div className="border-r border-b bg-muted" />
            {state.providers.slice(0, 2).map((provider) => (
              <div
                key={provider.id}
                className="border-r border-b bg-muted p-4 last:border-r-0"
              >
                <p className="text-sm font-semibold">{provider.displayName}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {
                    state.scheduleRules.filter(
                      (rule) => rule.providerId === provider.id && rule.enabled
                    ).length
                  }{' '}
                  weekly rules
                </p>
              </div>
            ))}
            {hours.map((hour) => (
              <div key={hour} className="contents">
                <div className="min-h-16 border-r border-b p-2 text-right font-mono text-[10px] text-muted-foreground">
                  {hour}
                </div>
                {state.providers.slice(0, 2).map((provider) => {
                  const appointment =
                    hour === '2 PM' && provider.displayName === 'Mara Ellis'
                      ? state.appointments.find((item) => item.status === 'scheduled')
                      : undefined
                  return (
                    <div
                      key={`${hour}-${provider.id}`}
                      className="min-h-16 border-r border-b p-1.5 last:border-r-0"
                    >
                      {appointment ? (
                        <button
                          type="button"
                          onClick={() => setSelectedId(appointment.id)}
                          className="h-full w-full border-l-2 border-primary bg-accent p-2 text-left"
                        >
                          <span className="block text-xs font-semibold">
                            {appointment.customer.name}
                          </span>
                          <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                            {appointment.serviceNames.join(' + ')}
                          </span>
                        </button>
                      ) : (
                        <span className="block h-full bg-muted/40" />
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
        <aside className="border bg-card">
          <div className="border-b p-5">
            <p className="text-sm font-semibold">Appointment snapshot</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Click a calendar item or recent confirmation.
            </p>
          </div>
          <div className="p-5">
            {selected ? <AppointmentDetail appointment={selected} /> : null}
          </div>
          <div className="border-t p-3">
            <p className="px-2 pb-2 text-xs font-medium text-muted-foreground">
              Recent confirmations
            </p>
            {state.appointments.map((appointment) => (
              <button
                key={appointment.id}
                type="button"
                onClick={() => setSelectedId(appointment.id)}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-xs ${appointment.id === selected?.id ? 'bg-accent' : 'hover:bg-muted'}`}
              >
                <span className="truncate">{appointment.customer.name}</span>
                <span className="font-mono text-muted-foreground">
                  {appointment.id}
                </span>
              </button>
            ))}
          </div>
        </aside>
      </div>
      <div className="mt-4 border border-dashed bg-card p-4 text-xs leading-5 text-muted-foreground">
        Source signal retained: the legacy `/appointments` home is a side-by-side
        provider calendar and opens Appointment details. Scope reduced: no manual
        booking, reschedule, recurring appointment, block time, refund/charge review, or
        Sale Order actions in this first slice.
      </div>
    </div>
  )
}

function SourceReductionNote() {
  return (
    <div className="border bg-foreground p-5 text-background">
      <p className="text-sm font-medium">Source reduction</p>
      <p className="mt-2 text-sm leading-6 opacity-70">
        The legacy Shop Details form mixes dozens of POS, payroll, notification,
        inventory, and booking flags. This surface keeps only inputs that can change the
        first customer booking journey.
      </p>
    </div>
  )
}

function VariantC({ state, actions, screen, setScreen }: VariantProps) {
  const stages = [
    {
      key: 'public-page',
      label: 'Discover',
      entity: 'Public page',
      path: '/settings/public-page',
      icon: Globe2Icon
    },
    {
      key: 'services',
      label: 'Choose',
      entity: 'Services',
      path: '/services',
      icon: ScissorsIcon
    },
    {
      key: 'providers',
      label: 'Assign',
      entity: 'Provider',
      path: '/settings/providers',
      icon: UserRoundIcon
    },
    {
      key: 'availability',
      label: 'Schedule',
      entity: 'Availability',
      path: '/availability',
      icon: Clock3Icon
    },
    {
      key: 'checkout',
      label: 'Confirm',
      entity: 'Checkout',
      path: '/settings/checkout',
      icon: CircleDollarSignIcon
    },
    {
      key: 'appointment',
      label: 'Review',
      entity: 'Appointment',
      path: '/appointments',
      icon: CalendarDaysIcon
    }
  ] as const
  const activeScreen = stages.some((stage) => stage.key === screen)
    ? screen
    : 'public-page'
  const activeStage = stages.find((stage) => stage.key === activeScreen) ?? stages[0]

  return (
    <div className="prototype-grid min-h-dvh bg-background pb-28">
      <header className="border-b bg-card">
        <div className="mx-auto flex min-h-16 max-w-[90rem] flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <p className="text-sm font-semibold">Booking chain</p>
              <p className="text-xs text-muted-foreground">
                {state.merchant.publicName}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge tone="neutral">Derived surface</StatusBadge>
            <Button variant="secondary">
              <EyeIcon className="size-4" />
              Customer preview
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[90rem] px-4 py-8 lg:px-8">
        <PageHeading
          eyebrow="Variant C · Booking chain"
          title="Edit the inputs where customers encounter them"
          description="The customer journey is the information architecture. Legacy Shop, Service, Staff, and Appointment surfaces are decomposed and reattached to the customer moment they influence."
        />
        <div className="mt-8 overflow-x-auto pb-3">
          <div className="grid min-w-[65rem] grid-cols-[repeat(6,minmax(9rem,1fr))] border bg-card">
            {stages.map((stage, index) => (
              <button
                key={stage.key}
                type="button"
                onClick={() => setScreen(stage.key)}
                className={`relative min-h-32 border-r p-4 text-left last:border-r-0 ${activeScreen === stage.key ? 'bg-foreground text-background' : 'hover:bg-muted'}`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`grid size-8 place-items-center rounded-md ${activeScreen === stage.key ? 'bg-background/15' : 'bg-secondary'}`}
                  >
                    <stage.icon className="size-4" />
                  </span>
                  <span className="font-mono text-xs opacity-60">0{index + 1}</span>
                </div>
                <p className="mt-5 text-xs opacity-70">{stage.label}</p>
                <p className="mt-1 text-sm font-semibold">{stage.entity}</p>
                {index < stages.length - 1 ? (
                  <span
                    className={`absolute -right-3 top-1/2 z-10 grid size-6 -translate-y-1/2 place-items-center rounded-full border ${activeScreen === stage.key ? 'bg-foreground' : 'bg-card'}`}
                  >
                    <ChevronRightIcon className="size-3.5" />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-6 xl:grid-cols-[16rem_minmax(0,1fr)_18rem]">
          <aside className="border bg-card p-5">
            <p className="text-xs font-medium text-muted-foreground">Customer moment</p>
            <h2 className="mt-2 text-lg font-semibold">{activeStage.label}</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {customerMoment(activeScreen)}
            </p>
            <div className="mt-6 border-t pt-4">
              <p className="text-xs text-muted-foreground">Proposed owner route</p>
              <p className="mt-2 break-all font-mono text-xs">{activeStage.path}</p>
            </div>
            <div className="mt-5 border-t pt-4">
              <p className="text-xs text-muted-foreground">Legacy source signal</p>
              <p className="mt-2 text-xs leading-5">
                {legacySourceSignal(activeScreen)}
              </p>
            </div>
          </aside>

          <JourneyStageEditor screen={activeScreen} state={state} actions={actions} />

          <aside className="space-y-5">
            <div className="border bg-foreground p-5 text-background">
              <p className="text-xs opacity-60">Chain health</p>
              <p className="mt-2 text-3xl font-semibold">
                {getReadiness(state).percent}%
              </p>
              <p className="mt-2 text-sm opacity-70">
                All persisted inputs connect to a customer-visible outcome.
              </p>
            </div>
            <div className="border bg-card p-5">
              <p className="text-sm font-medium">What is absent</p>
              <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
                <li>• No Shop or Brand setup</li>
                <li>• No stored time slots</li>
                <li>• No durable Customer profiles</li>
                <li>• No Sale Order screen</li>
              </ul>
            </div>
          </aside>
        </div>
        <PrototypeStatePanel state={state} />
      </main>
    </div>
  )
}

function JourneyStageEditor({
  screen,
  state,
  actions
}: Omit<VariantProps, 'setScreen'>) {
  const firstService = state.services[0]
  if (screen === 'public-page') {
    return (
      <Panel
        title="Public page input"
        description="The Merchant is the public identity."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Public name">
            <Input
              value={state.merchant.publicName}
              onChange={actions.setMerchantName}
            />
          </Field>
          <Field label="Slug">
            <Input
              value={state.merchant.slug}
              onChange={actions.setMerchantSlug}
              mono
            />
          </Field>
        </div>
        <div className="mt-6 flex items-center justify-between border-t pt-5">
          <span className="text-sm text-muted-foreground">
            Current state: {state.merchant.publicPageStatus}
          </span>
          <Button onClick={actions.togglePublished}>
            {state.merchant.publicPageStatus === 'published' ? 'Unpublish' : 'Publish'}{' '}
            page
          </Button>
        </div>
      </Panel>
    )
  }
  if (screen === 'services') {
    return (
      <Panel
        title="Service choice input"
        description="These cards become the customer selection step."
      >
        <div className="grid gap-3">
          {state.services.map((service) => (
            <div
              key={service.id}
              className="flex items-center justify-between gap-4 border bg-muted p-4"
            >
              <div>
                <p className="text-sm font-medium">{service.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {service.durationMinutes} min · {service.providerIds.length} eligible
                  providers
                </p>
              </div>
              <span className="font-mono text-sm">
                {formatMoney(service.priceMinor)}
              </span>
            </div>
          ))}
        </div>
        <Button variant="secondary" className="mt-5" onClick={actions.addService}>
          <PlusIcon className="size-4" />
          Add another choice
        </Button>
      </Panel>
    )
  }
  if (screen === 'providers') {
    return (
      <Panel
        title="Provider preference input"
        description="Solo hides this moment; Team exposes Specific provider or Any provider."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {state.providers.map((provider) => (
            <div key={provider.id} className="border bg-muted p-4">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-full bg-card">
                  <UserRoundIcon className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-medium">{provider.displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    {provider.isDefault ? 'Default' : 'Team'} provider
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
        <Button variant="secondary" className="mt-5" onClick={actions.addProvider}>
          <PlusIcon className="size-4" />
          Add provider
        </Button>
      </Panel>
    )
  }
  if (screen === 'availability') {
    return <ScheduleEditor state={state} actions={actions} />
  }
  if (screen === 'checkout') {
    return (
      <Panel
        title="Confirmation input"
        description="Checkout policy intersects with configured provider readiness."
      >
        <div className="flex items-start gap-4 border bg-muted p-5">
          <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <CheckIcon className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium">Pay in person</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Available without external provider configuration.
            </p>
          </div>
        </div>
        <div className="mt-4 border border-dashed p-5 text-sm text-muted-foreground">
          Pay now will appear here when issue 09 settles the provider-specific payment
          state.
        </div>
      </Panel>
    )
  }
  return (
    <Panel
      title="Appointment confirmation result"
      description="Inspect the exact snapshot accepted when the Booking Session confirmed."
    >
      {state.appointments[0] ? (
        <AppointmentDetail appointment={state.appointments[0]} />
      ) : (
        <p>No appointments yet.</p>
      )}
      {firstService ? (
        <p className="mt-5 border-t pt-4 text-xs text-muted-foreground">
          Later edits to “{firstService.name}” do not rewrite this snapshot.
        </p>
      ) : null}
    </Panel>
  )
}

function ScheduleEditor({
  state,
  actions,
  providerId
}: {
  readonly state: PrototypeState
  readonly actions: PrototypeActions
  readonly providerId?: string | undefined
}) {
  const activeProvider =
    state.providers.find((provider) => provider.id === providerId) ?? state.providers[0]
  const rules = activeProvider
    ? state.scheduleRules.filter((rule) => rule.providerId === activeProvider.id)
    : []
  return (
    <div className="border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
        <div>
          <h2 className="font-semibold">Weekly schedule</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeProvider?.displayName ?? 'No provider'}
          </p>
        </div>
        <StatusBadge tone="neutral">{state.merchant.timeZone}</StatusBadge>
      </div>
      <div className="divide-y">
        {rules.map((rule) => (
          <div
            key={`${rule.providerId}-${rule.day}`}
            className="grid gap-3 p-4 sm:grid-cols-[6rem_5rem_minmax(0,1fr)_minmax(0,1fr)] sm:items-center"
          >
            <span className="text-sm font-medium">{rule.day}</span>
            <button
              type="button"
              onClick={() => actions.toggleScheduleDay(rule.providerId, rule.day)}
              className={`h-8 rounded-md px-2 text-xs font-medium ${rule.enabled ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}
            >
              {rule.enabled ? 'Working' : 'Off'}
            </button>
            <input
              aria-label={`${rule.day} start time`}
              type="time"
              disabled={!rule.enabled}
              value={rule.start}
              onChange={(event) =>
                actions.updateScheduleTime(
                  rule.providerId,
                  rule.day,
                  'start',
                  event.target.value
                )
              }
              className="h-9 rounded-md border bg-card px-3 font-mono text-sm disabled:opacity-40"
            />
            <input
              aria-label={`${rule.day} end time`}
              type="time"
              disabled={!rule.enabled}
              value={rule.end}
              onChange={(event) =>
                actions.updateScheduleTime(
                  rule.providerId,
                  rule.day,
                  'end',
                  event.target.value
                )
              }
              className="h-9 rounded-md border bg-card px-3 font-mono text-sm disabled:opacity-40"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function DerivedAvailability({ state }: { readonly state: PrototypeState }) {
  const enabledRules = state.scheduleRules.filter((rule) => rule.enabled).length
  const derivedSlots = Math.max(
    0,
    enabledRules * 8 -
      state.appointments.filter((appointment) => appointment.status === 'scheduled')
        .length
  )
  return (
    <div className="border bg-foreground p-5 text-background">
      <p className="text-xs opacity-60">Derived preview</p>
      <p className="mt-3 text-4xl font-semibold">{derivedSlots}</p>
      <p className="mt-1 text-sm opacity-70">candidate slots this week</p>
      <dl className="mt-6 grid gap-3 border-t border-background/20 pt-5 text-sm">
        <Fact label="Rules" value={`${enabledRules} recurring`} inverse />
        <Fact
          label="Conflicts"
          value={`${state.appointments.filter((appointment) => appointment.status === 'scheduled').length} appointment`}
          inverse
        />
        <Fact label="Stored slots" value="0" inverse />
      </dl>
    </div>
  )
}

function AppointmentList({ state }: { readonly state: PrototypeState }) {
  return (
    <div className="mt-8 border bg-card">
      <div className="hidden grid-cols-[10rem_minmax(0,1fr)_10rem_8rem_7rem] gap-4 border-b bg-muted px-5 py-3 text-xs font-medium text-muted-foreground md:grid">
        <span>Time</span>
        <span>Customer / service</span>
        <span>Provider</span>
        <span>Total</span>
        <span>Status</span>
      </div>
      <div className="divide-y">
        {state.appointments.map((appointment) => (
          <div
            key={appointment.id}
            className="grid gap-3 px-5 py-4 text-sm md:grid-cols-[10rem_minmax(0,1fr)_10rem_8rem_7rem] md:items-center"
          >
            <span className="font-mono text-xs">
              {formatDate(appointment.startsAt)}
            </span>
            <span className="min-w-0">
              <span className="block font-medium">{appointment.customer.name}</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {appointment.serviceNames.join(' + ')}
              </span>
            </span>
            <span>{appointment.providerName}</span>
            <span className="font-mono">{formatMoney(appointment.totalMinor)}</span>
            <StatusBadge tone={appointment.status === 'scheduled' ? 'good' : 'neutral'}>
              {appointment.status}
            </StatusBadge>
          </div>
        ))}
      </div>
    </div>
  )
}

function AppointmentDetail({ appointment }: { readonly appointment: Appointment }) {
  return (
    <dl className="grid gap-4 text-sm sm:grid-cols-2">
      <Fact label="Appointment" value={appointment.id} />
      <Fact label="Starts" value={formatDate(appointment.startsAt)} />
      <Fact label="Customer" value={appointment.customer.name} />
      <Fact label="Contact" value={appointment.customer.email} />
      <Fact
        label="Provider"
        value={`${appointment.providerName} · ${appointment.providerPreference}`}
      />
      <Fact label="Services" value={appointment.serviceNames.join(' + ')} />
      <Fact label="Checkout" value="Pay in person" />
      <Fact label="Total" value={formatMoney(appointment.totalMinor)} />
    </dl>
  )
}

function CustomerDirectory({ state }: { readonly state: PrototypeState }) {
  return (
    <div className="mt-8 border bg-card">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem] gap-4 border-b bg-muted px-5 py-3 text-xs font-medium text-muted-foreground">
        <span>Name</span>
        <span>Contact captured</span>
        <span>Bookings</span>
      </div>
      {state.appointments.map((appointment) => (
        <div
          key={appointment.id}
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem] gap-4 border-b px-5 py-4 text-sm last:border-b-0"
        >
          <span className="font-medium">{appointment.customer.name}</span>
          <span className="truncate text-muted-foreground">
            {appointment.customer.email}
          </span>
          <span className="font-mono">1</span>
        </div>
      ))}
    </div>
  )
}

function PrototypeStatePanel({ state }: { readonly state: PrototypeState }) {
  const readiness = getReadiness(state)
  const projected = useMemo(
    () => ({
      persisted: state,
      derived: {
        bookingReadiness: readiness.checks.reduce<Record<string, boolean>>(
          (result, check) => ({ ...result, [check.label]: check.ready }),
          {}
        ),
        customerDirectoryEntries: state.appointments.length,
        generatedTimeSlotsStored: 0
      },
      deliberatelyAbsent: [
        'Shop rows',
        'Brand rows',
        'Customer profiles',
        'Sale Orders',
        'stored Availability'
      ]
    }),
    [state, readiness.checks]
  )

  return (
    <details className="mt-10 border bg-card" open>
      <summary className="cursor-pointer select-none px-5 py-4 text-sm font-medium">
        Prototype state · updates after every in-memory action
      </summary>
      <pre className="max-h-80 overflow-auto border-t bg-muted p-5 font-mono text-xs leading-5 text-muted-foreground">
        {JSON.stringify(projected, null, 2)}
      </pre>
    </details>
  )
}

function PrototypeSwitcher({
  current,
  setVariant
}: {
  readonly current: VariantKey
  readonly setVariant: (variant: VariantKey) => void
}) {
  const variants: ReadonlyArray<VariantKey> = ['A', 'B', 'C']
  const move = (direction: -1 | 1) => {
    const currentIndex = variants.indexOf(current)
    const nextIndex = (currentIndex + direction + variants.length) % variants.length
    const next = variants[nextIndex]
    if (next) setVariant(next)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || target?.matches('input, textarea, select'))
        return
      if (event.key === 'ArrowLeft') move(-1)
      if (event.key === 'ArrowRight') move(1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div
      className="fixed inset-x-3 bottom-4 z-50 mx-auto flex h-12 max-w-md items-center justify-between rounded-full border border-foreground/20 bg-foreground px-2 text-background shadow-md"
      role="toolbar"
      aria-label="Prototype variants"
    >
      <button
        type="button"
        onClick={() => move(-1)}
        className="grid size-9 place-items-center rounded-full hover:bg-background/15"
        aria-label="Previous variant"
      >
        <ArrowLeftIcon className="size-4" />
      </button>
      <div className="text-center">
        <p className="text-sm font-medium">
          {current} — {variantNames[current]}
        </p>
        <p className="text-[10px] opacity-60">← → to compare</p>
      </div>
      <button
        type="button"
        onClick={() => move(1)}
        className="grid size-9 place-items-center rounded-full hover:bg-background/15"
        aria-label="Next variant"
      >
        <ArrowRightIcon className="size-4" />
      </button>
    </div>
  )
}

function BrandMark() {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
      <span className="size-2.5 border border-current" />
    </span>
  )
}

function PageHeading({
  eyebrow,
  title,
  description,
  action
}: {
  readonly eyebrow: string
  readonly title: string
  readonly description: string
  readonly action?: ReactNode
}) {
  return (
    <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div className="max-w-3xl">
        <p className="text-xs font-medium text-primary">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

function Panel({
  title,
  description,
  children
}: {
  readonly title: string
  readonly description: string
  readonly children: ReactNode
}) {
  return (
    <section className="border bg-card">
      <div className="border-b p-5">
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

function Field({
  label,
  children
}: {
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  )
}

function Input({
  value,
  onChange,
  prefix,
  mono = false,
  type = 'text'
}: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly prefix?: string
  readonly mono?: boolean
  readonly type?: 'text' | 'number'
}) {
  if (prefix)
    return (
      <span className="flex h-9 overflow-hidden rounded-md border bg-card">
        <span className="flex items-center border-r bg-muted px-3 font-mono text-xs text-muted-foreground">
          {prefix}
        </span>
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`min-w-0 flex-1 bg-card px-3 text-sm ${mono ? 'font-mono' : ''}`}
        />
      </span>
    )
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`h-9 w-full rounded-md border bg-card px-3 text-sm ${mono ? 'font-mono' : ''}`}
    />
  )
}

function ReadOnlyField({
  label,
  value
}: {
  readonly label: string
  readonly value: string
}) {
  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-2 flex h-9 items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">
        {value}
      </p>
    </div>
  )
}

function Button({
  children,
  variant = 'primary',
  onClick,
  className = ''
}: {
  readonly children: ReactNode
  readonly variant?: 'primary' | 'secondary'
  readonly onClick?: () => void
  readonly className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium ${variant === 'primary' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-secondary text-secondary-foreground hover:bg-secondary/70'} ${className}`}
    >
      {children}
    </button>
  )
}

function StatusBadge({
  children,
  tone
}: {
  readonly children: ReactNode
  readonly tone: 'good' | 'neutral'
}) {
  return (
    <span
      className={`inline-flex h-[22px] w-fit items-center rounded-md px-2 text-xs font-medium ${tone === 'good' ? 'bg-accent text-accent-foreground' : 'bg-secondary text-secondary-foreground'}`}
    >
      {children}
    </span>
  )
}

function Fact({
  label,
  value,
  inverse = false
}: {
  readonly label: string
  readonly value: string
  readonly inverse?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className={inverse ? 'opacity-60' : 'text-muted-foreground'}>{label}</dt>
      <dd className="max-w-[65%] text-right font-medium">{value}</dd>
    </div>
  )
}

function DeferredStructure() {
  return (
    <div className="border border-dashed bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary">
          <MapPinIcon className="size-4" />
        </span>
        <div>
          <p className="text-sm font-medium">Shops and Brands are deferred</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            They are future multi-location growth structure, not a prerequisite for a
            merchant to become bookable.
          </p>
        </div>
      </div>
    </div>
  )
}

function getReadiness(state: PrototypeState) {
  const activeServices = state.services.filter((service) => service.status === 'active')
  const activeProviders = state.providers.filter(
    (provider) => provider.status === 'active'
  )
  const eligibleProviderIds = new Set(
    activeServices.flatMap((service) => service.providerIds)
  )
  const eligibleProviders = activeProviders.filter((provider) =>
    eligibleProviderIds.has(provider.id)
  )
  const checks = [
    {
      label: 'Public identity',
      detail: 'Name and public slug',
      ready:
        state.merchant.publicName.trim().length > 0 &&
        state.merchant.slug.trim().length > 0,
      screen: 'business'
    },
    {
      label: 'Active service',
      detail: `${activeServices.length} customer choices`,
      ready: activeServices.length > 0,
      screen: 'services'
    },
    {
      label: 'Eligible provider',
      detail: `${eligibleProviders.length} people can perform active services`,
      ready: eligibleProviders.length > 0,
      screen: 'providers'
    },
    {
      label: 'Working hours',
      detail: 'Recurring provider Schedule Rules',
      ready: state.scheduleRules.some(
        (rule) => rule.enabled && eligibleProviderIds.has(rule.providerId)
      ),
      screen: 'hours'
    },
    {
      label: 'Checkout choice',
      detail: 'Pay in person is enough to launch',
      ready: state.checkoutChoices.length > 0,
      screen: 'checkout'
    }
  ]
  const complete = checks.filter((check) => check.ready).length
  return {
    checks,
    complete,
    total: checks.length,
    percent: Math.round((complete / checks.length) * 100)
  }
}

function customerMoment(screen: string) {
  if (screen === 'public-page')
    return 'A customer discovers the merchant and starts from one public booking presence.'
  if (screen === 'services')
    return 'A customer chooses one primary service and may add compatible additional services.'
  if (screen === 'providers')
    return 'A Team customer chooses a specific provider or Any provider. Solo skips this step.'
  if (screen === 'availability')
    return 'A customer sees candidate Time Slots derived from rules, eligibility, duration, conflicts, and holds.'
  if (screen === 'checkout')
    return 'A customer supplies details and chooses a merchant-enabled checkout path.'
  return 'A confirmed customer and the merchant inspect the immutable Appointment snapshot.'
}

function legacySourceSignal(screen: string) {
  if (screen === 'public-page')
    return 'ShopForm: shop name, alias, description, timezone, contact details, and address.'
  if (screen === 'services')
    return 'ServicesWrapper: Details first, then assignment to barbers and locations.'
  if (screen === 'providers')
    return 'BarberForm: Profile, Services, Schedule, Notifications, Permissions, Options, and Appointments tabs.'
  if (screen === 'availability')
    return 'ShopForm + BarberForm schedules: recurring workdays plus days on/off and conflict handling.'
  if (screen === 'checkout')
    return 'BookingSettings + ShopForm: booking without payment, card reservation, prepayment, and in-person policy.'
  return 'SideBySideView + AppointmentForm: provider calendar, details modal, and explicit change confirmation.'
}

function formatMoney(amountMinor: number) {
  return moneyFormatter.format(amountMinor / 100)
}

function formatDate(value: string) {
  const parts = appointmentDateFormatter.formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? ''
  return `${part('month')} ${part('day')} · ${part('hour')}:${part('minute')} ${part('dayPeriod')}`
}
