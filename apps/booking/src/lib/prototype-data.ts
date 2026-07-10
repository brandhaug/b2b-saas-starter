export type ScenarioKey = 'ready' | 'no-services' | 'no-times' | 'slot-lost'

export type BookingStage =
  | 'provider'
  | 'service'
  | 'schedule'
  | 'details'
  | 'checkout'
  | 'confirmation'

export type CheckoutChoice = 'pay-now' | 'pay-in-person'

export interface BookingPrototypeState {
  readonly providerPreference: string | null
  readonly primaryServiceId: string | null
  readonly additionalServiceIds: ReadonlyArray<string>
  readonly slotId: string | null
  readonly customer: {
    readonly name: string
    readonly email: string
    readonly phone: string
  }
  readonly checkoutChoice: CheckoutChoice | null
  readonly confirmed: boolean
}

export interface ProviderFixture {
  readonly id: string
  readonly name: string
  readonly initials: string
  readonly role: string
  readonly next: string
}

export interface ServiceFixture {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly durationMinutes: number
  readonly amountMinor: number
  readonly category: string
}

export interface SlotFixture {
  readonly id: string
  readonly day: string
  readonly date: string
  readonly time: string
}

export const scenarios: ReadonlyArray<{
  readonly key: ScenarioKey
  readonly name: string
}> = [
  { key: 'ready', name: 'Ready fixture' },
  { key: 'no-services', name: 'No services' },
  { key: 'no-times', name: 'No times' },
  { key: 'slot-lost', name: 'Slot lost' }
]

export const stages: ReadonlyArray<BookingStage> = [
  'provider',
  'service',
  'schedule',
  'details',
  'checkout',
  'confirmation'
]

export const providers: ReadonlyArray<ProviderFixture> = [
  {
    id: 'any',
    name: 'Choose a service first',
    initials: 'ANY',
    role: 'Book with any professional',
    next: 'First eligible professional'
  },
  {
    id: 'prv_ava',
    name: 'Ava S.',
    initials: 'AS',
    role: 'Signature Cut',
    next: 'Tomorrow at 11:00 AM'
  },
  {
    id: 'prv_noah',
    name: 'Noah B.',
    initials: 'NB',
    role: 'Beard Trim',
    next: 'Friday at 12:00 PM'
  }
]

export const services: ReadonlyArray<ServiceFixture> = [
  {
    id: 'svc_signature',
    name: 'Signature Cut',
    description: 'A precise cut, wash, and style.',
    durationMinutes: 45,
    amountMinor: 4500,
    category: 'Haircuts'
  },
  {
    id: 'svc_beard',
    name: 'Beard Trim',
    description: 'Shape, trim, and hot towel finish.',
    durationMinutes: 30,
    amountMinor: 2800,
    category: 'Grooming'
  },
  {
    id: 'svc_shampoo',
    name: 'Shampoo Finish',
    description: 'Relaxing shampoo and scalp refresh.',
    durationMinutes: 15,
    amountMinor: 1200,
    category: 'Add-ons'
  }
]

export const additionalServices: ReadonlyArray<ServiceFixture> = [
  { ...services[1]!, id: 'addon_beard', category: 'Add-ons' },
  { ...services[2]!, id: 'addon_shampoo', category: 'Add-ons' }
]

export const slots: ReadonlyArray<SlotFixture> = [
  { id: 'slot_1', day: 'Fri', date: 'Jul 10', time: '10:00 AM' },
  { id: 'slot_2', day: 'Fri', date: 'Jul 10', time: '2:00 PM' },
  { id: 'slot_3', day: 'Fri', date: 'Jul 10', time: '4:00 PM' }
]

export const initialBookingState: BookingPrototypeState = {
  providerPreference: null,
  primaryServiceId: null,
  additionalServiceIds: [],
  slotId: null,
  customer: { name: '', email: '', phone: '' },
  checkoutChoice: null,
  confirmed: false
}

const priceFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
})

export function formatPrice(amountMinor: number): string {
  return priceFormatter.format(amountMinor / 100)
}

export function getBookingTotal(state: BookingPrototypeState): number {
  const primary = services.find((service) => service.id === state.primaryServiceId)
  const selectedIds = new Set(state.additionalServiceIds)
  const additions = additionalServices.filter((service) => selectedIds.has(service.id))

  return (
    (primary?.amountMinor ?? 0) +
    additions.reduce((total, service) => total + service.amountMinor, 0)
  )
}

export function getBookingDuration(state: BookingPrototypeState): number {
  const primary = services.find((service) => service.id === state.primaryServiceId)
  const selectedIds = new Set(state.additionalServiceIds)
  const additions = additionalServices.filter((service) => selectedIds.has(service.id))

  return (
    (primary?.durationMinutes ?? 0) +
    additions.reduce((total, service) => total + service.durationMinutes, 0)
  )
}

export function getPrototypePath(
  merchantSlug: string,
  stage: BookingStage,
  state: BookingPrototypeState
): string {
  const base = `/${merchantSlug}/booking`
  const provider = state.providerPreference ?? 'any'
  const service = state.primaryServiceId ?? 'choose'

  if (stage === 'provider') return `${base}/providers`
  if (stage === 'service') return `${base}/providers/${provider}/services`
  if (stage === 'schedule') {
    return `${base}/providers/${provider}/services/${service}/schedule`
  }
  if (stage === 'confirmation') return `${base}/confirmations/demo-123`
  return `${base}/session/demo-session/checkout`
}
