import type {
  ParityInventoryItem,
  ParityInventoryKind,
  ParityLedger,
  ParityLedgerEntry,
  ParityStatus
} from './full-parity-ledger.ts'

const source = '.scratch/legacy-booking-app-full-parity'
const inventory: ParityInventoryItem[] = []
const entries: ParityLedgerEntry[] = []

const accept = (
  kind: ParityInventoryKind,
  owner: string,
  status: ParityStatus,
  items: Readonly<Record<string, string>>,
  evidence: string
) => {
  for (const [name, description] of Object.entries(items)) {
    const id = `${kind}:${name}`
    inventory.push({ id, kind, description, source: `${source}/${evidence}` })
    entries.push({
      inventoryId: id,
      owner,
      scenario: `parity/${kind}/${name}`,
      status
    })
  }
}

accept(
  'route',
  'booking-app/routes',
  'planned',
  {
    '/brands/:brandIdOrRoute': 'Multi-location Brand and Shop selection.',
    '/book/:shopIdOrRoute': 'Merchant entry and Provider selection.',
    '/book/:shopIdOrRoute/barber/:barberIdOrRoute/services':
      'Primary and Additional Service selection.',
    '/book/:shopIdOrRoute/barber/:barberIdOrRoute/schedule':
      'Availability and Time Slot selection.',
    '/gift-card/:shopIdOrRoute/barber/:barberIdOrRoute':
      'Assigned and unassigned Gift Card purchase.',
    '/view-reservation/:saleOrderId':
      'Protected confirmation and Appointment management.',
    '/view-gift-card/:saleOrderId': 'Protected Gift Card receipt.',
    '/waiting-list/:waitingListApplicationId/:attemptId?':
      'Waiting List Application and Availability Offer lifecycle.',
    '/book/:shopIdOrRoute/walkin-list': 'Walk-in landing and gate.',
    '/book/:shopIdOrRoute/walkin-list/barber/any/services':
      'Walk-in Service and Customer Details enrollment.',
    '/book/:shopIdOrRoute/walkin-list/success': 'Walk-in acknowledgement.',
    '/vnmcvnmmfjjfjfhfhfhfhjurur7474774hdbdbdbnbn':
      'Deliberate error scenario without production diagnostics ingress.',
    unmatched: 'Localized unmatched-route recovery.'
  },
  'research/legacy-booking-journey-state-inventory.md'
)

accept(
  'journey',
  'capabilities/booking',
  'planned',
  {
    'standard-appointment':
      'Single-request appointment from entry through confirmation.',
    'group-appointment': 'Composite Booking Party with coordinated requests and holds.',
    'assigned-gift-card': 'Provider-scoped Gift Card purchase and issuance.',
    'unassigned-gift-card': 'Merchant, Brand, or Shop Gift Card purchase and issuance.',
    'pay-in-person': 'Provider-free confirmation with no Payment.',
    'online-payment': 'Eligible online payment methods and reconciliation.',
    'gift-card-redemption': 'Full, partial, and mixed settlement.',
    'confirmation-management': 'Protected view, cancel, and reschedule actions.',
    'waiting-list-offer': 'Application, offer, acceptance, decline, and expiry.',
    'waiting-list-reschedule': 'Offer-driven protected Appointment rescheduling.',
    'walk-in-enrollment': 'Configured queue enrollment and lifecycle.',
    'verified-continuation': 'Optional identity recovery with anonymous equivalence.'
  },
  'research/reproducible-legacy-parity-baseline.md'
)

accept(
  'state',
  'booking-app/presentation',
  'planned',
  {
    'brand-loading': 'Brand and Booking data loading.',
    'brand-default-source': 'Default Shop source.',
    'brand-search-source': 'Searched Shop source.',
    'brand-nearby-source': 'Nearby Shop source.',
    'brand-selected': 'Selected Shop confirmation.',
    'brand-partial-language': 'Partially translated merchant content.',
    'brand-empty': 'Empty Brand recovery.',
    'brand-failure': 'Failed Brand recovery.',
    'shop-loading-cards': 'Seven Provider loading cards.',
    'shop-any-provider': 'Any Provider selection.',
    'shop-specific-provider': 'Specific Provider selection.',
    'shop-about-overlay': 'Provider about overlay.',
    'shop-passcode-accepted': 'Provider passcode accepted.',
    'shop-passcode-rejected': 'Provider passcode rejected.',
    'shop-passcode-cached': 'Provider passcode proof reused.',
    'shop-group-restriction': 'Group flow Provider restriction.',
    'shop-gift-card-entry': 'Conditional Gift Card entry.',
    'services-skeleton': 'Minimum-duration Service skeleton.',
    'services-list': 'Initial Service list.',
    'services-selected': 'Selected Primary Service.',
    'services-additional': 'Additional Service view.',
    'services-url-preselection': 'Consumed URL Service preselection.',
    'services-empty-blank': 'Accepted post-skeleton empty Service state.',
    'schedule-loading': 'Availability loading.',
    'schedule-fetch-disabled': 'Controls disabled while Availability fetches.',
    'schedule-date-disabled': 'Disabled and out-of-range dates.',
    'schedule-empty': 'No-slot timetable.',
    'schedule-expanded': 'Expanded timetable.',
    'schedule-selected': 'Selected Time Slot.',
    'gift-card-null-reservation': 'No page without a purchase request.',
    'gift-card-assigned': 'Provider-assigned Gift Card presentation.',
    'gift-card-unassigned': 'Unassigned Gift Card presentation.',
    'gift-card-preset': 'Preset Gift Card amount.',
    'gift-card-custom': 'Custom Gift Card amount.',
    'gift-card-cart': 'Opened Gift Card checkout cart.',
    'confirmation-loading': 'Blank receipt loading.',
    'confirmation-api-error': 'Receipt API error recovery.',
    'confirmation-pending': 'Processing Appointment.',
    'confirmation-single': 'Single Appointment outcome.',
    'confirmation-group': 'Composite Appointment outcome.',
    'confirmation-cancelled': 'Cancelled Appointment outcome.',
    'confirmation-management-eligible': 'Eligible management action.',
    'confirmation-management-ineligible': 'Ineligible management action.',
    'confirmation-mutation-loading': 'Management mutation loading.',
    'confirmation-mutation-error': 'Management mutation failure.',
    'confirmation-card': 'Card Payment facts.',
    'confirmation-pay-in-person': 'Pay In Person facts.',
    'confirmation-ad': 'Optional post-confirmation ad.',
    'confirmation-app-link': 'Delayed app-link overlay.',
    'gift-card-receipt-loading': 'Accepted Gift Card receipt loading blank.',
    'gift-card-receipt-brand-scope': 'Brand-wide scope.',
    'gift-card-receipt-shop-scope': 'Shop-only scope.',
    'gift-card-receipt-provider-scope': 'Provider-specific scope.',
    'gift-card-receipt-payment': 'Optional Payment facts.',
    'gift-card-receipt-malformed': 'Malformed receipt neutral recovery.',
    'waiting-list-loading': 'Accepted aggregate loading blank.',
    'waiting-list-active': 'Active application.',
    'waiting-list-available': 'Available offer.',
    'waiting-list-selected': 'Selected offer.',
    'waiting-list-expired': 'Expired offer.',
    'waiting-list-reschedule-selected': 'Selected reschedule offer.',
    'waiting-list-removed-blank': 'Removed terminal presentation.',
    'waiting-list-used-blank': 'Used terminal presentation.',
    'waiting-list-rescheduled-blank': 'Rescheduled terminal presentation.',
    'waiting-list-attempt-recovery': 'Invalid attempt recovery to base application.',
    'waiting-list-processing': 'Offer mutation processing.',
    'waiting-list-failure': 'Offer mutation failure.',
    'walk-in-loading': 'Shop loading blank.',
    'walk-in-open': 'Configured open gate.',
    'walk-in-closed': 'Configured closed gate.',
    'walk-in-drawer-open': 'Enrollment drawer open.',
    'walk-in-drawer-closed': 'Enrollment drawer closed.',
    'walk-in-service': 'Walk-in Service selection.',
    'walk-in-additional-service': 'Walk-in Additional Service selection.',
    'walk-in-details-validation': 'Customer Details validation.',
    'walk-in-submit-loading': 'Submit loading.',
    'walk-in-submit-failure': 'Submit failure toast.',
    'walk-in-success': 'Acknowledgement with Shop fallback.',
    'unmatched-blank': 'Accepted unmatched-route blank evidence.',
    'version-conflict': 'Version conflict recovery.',
    'hold-conflict': 'Time Slot Hold conflict recovery.',
    'session-expired': 'Expired Booking Session recovery.',
    'hold-expired': 'Expired Time Slot Hold recovery.',
    'quote-expired': 'Expired Pricing Quote recovery.',
    'token-expired': 'Expired access token recovery.',
    processing: 'Uncertain external settlement or local commitment.',
    disabled: 'Optional provider or feature disabled.',
    'needs-configuration': 'Optional provider is enabled but unconfigured.'
  },
  'PRD.md'
)

accept(
  'locale',
  'booking-app/localization',
  'implemented',
  {
    en: 'English catalog and en-US formatting profile.',
    es: 'Spanish catalog and formatting profile.',
    fr: 'French catalog and fr-CA formatting profile.',
    ro: 'Romanian catalog and ro-RO formatting profile.'
  },
  'issues/08-decide-localization-contract.md'
)

accept(
  'viewport',
  'booking-app/presentation',
  'planned',
  {
    'mobile-narrow-375x812': '375x812 touch standalone breakpoint.',
    'mobile-wide-376x812': '376x812 touch standalone boundary.',
    'tablet-widget-768x900-iframe-375x700':
      '768x900 touch viewport with a 375x700 constrained iframe.',
    'laptop-1024x768': '1024x768 mouse and hover breakpoint.',
    'desktop-1440x900': '1440x900 mouse and hover maximum design breakpoint.',
    'zoom-200': 'Shared layout at 200% text zoom.'
  },
  'research/reproducible-legacy-parity-baseline.md'
)

accept(
  'embedding',
  'booking-app/routes',
  'planned',
  {
    standalone: 'Top-level browser navigation.',
    iframe: 'Embedded iframe profile and scroll ownership.',
    'partner-acquisition': 'Allowlisted acquisition and partner inputs.'
  },
  'issues/06-decide-route-and-session-compatibility.md'
)

accept(
  'integration',
  'booking-app/providers',
  'planned',
  {
    'provider-free': 'All optional providers absent.',
    'stripe-cards': 'Configured card and saved-method adapter.',
    wallets: 'Eligible Apple Pay, Google Pay, and Cash App Pay.',
    bnpl: 'Eligible provider-backed BNPL.',
    email: 'Operational email delivery states.',
    identity: 'Optional Google and Apple identity.',
    analytics: 'Consent-gated provider-neutral funnel telemetry.',
    monitoring: 'Optional error-reporting adapter.',
    maps: 'Ordinary URL or configured map adapter.'
  },
  'issues/07-decide-optional-integrations-and-feature-variants.md'
)

accept(
  'defect',
  'booking-app/presentation',
  'planned',
  {
    'schedule-unresolved-loading': 'Correct unresolved schedule loading.',
    'schedule-empty-without-recovery': 'Correct non-actionable schedule emptiness.',
    'waiting-list-terminal-blank':
      'Retain only explicitly accepted blank terminal states.',
    'receipt-malformed-data': 'Use neutral recovery for malformed receipt data.',
    'raw-localization-key': 'Never expose raw translation keys.'
  },
  'PRD.md'
)

accept(
  'inferred-branch',
  'parity-harness/scenarios',
  'planned',
  {
    'brand-load-failure': 'Source-inferred Brand load failure.',
    'provider-passcode': 'Provider access accepted, rejected, and cached.',
    'group-incomplete': 'Incomplete composite Booking Party continuation.',
    'payment-3ds': 'Provider challenge success, cancel, and failure.',
    'waiting-list-expired-attempt': 'Expired offer attempt recovery.',
    'walk-in-closed': 'Closed and cannot-enroll profiles.',
    'mutation-network-failure': 'Declared request failure and retry.'
  },
  'research/reproducible-legacy-parity-baseline.md'
)

accept(
  'vocabulary',
  'architecture/domain',
  'implemented',
  {
    'booking-party': 'Booking Party and Booking Request replace Cart and Reservation.',
    'pricing-quote': 'Immutable Pricing Quote and Adjustment vocabulary.',
    settlement: 'Payment and Settlement Allocation vocabulary.',
    'customer-privacy':
      'Customer Details, optional identity, and purpose-bound access.',
    'operational-work': 'Notification Intent, Reminder, and scheduled work vocabulary.'
  },
  'issues/14-define-full-parity-domain-model-and-aggregate-invariants.md'
)

accept(
  'module-boundary',
  'architecture/modules',
  'implemented',
  {
    capabilities: 'Business behavior belongs to explicit capability subpaths.',
    persistence: 'D1 mechanics remain in packages/db behind capabilities.',
    presentation:
      'Theme, localization, browser integration, and routes stay in apps/booking.',
    providers: 'Concrete provider adapters remain at Worker runtime edges.',
    'no-new-package': 'No new workspace package without demonstrated reuse.'
  },
  'issues/11-decide-target-module-and-package-boundaries.md'
)

accept(
  'asset-policy',
  'booking-app/assets',
  'implemented',
  {
    manifest: 'Every shipped visual binary has provenance and integrity metadata.',
    'prohibited-fonts': 'Legacy SF Pro and password-mask binaries are prohibited.',
    'licensed-bebas': 'Bebas Neue comes from a traceable OFL upstream artifact.',
    'product-owned-replacements': 'Unknown UI art is independently owned or licensed.',
    'official-provider-marks': 'Provider marks come from approved official sources.'
  },
  'issues/13-establish-visual-asset-provenance-and-replacement-policy.md'
)

accept(
  'retirement',
  'architecture/cutover',
  'planned',
  {
    'legacy-link-compatibility': 'Legacy URL compatibility is explicitly rejected.',
    'legacy-package-topology': 'The @water-web package graph is not recreated.',
    'legacy-domain-model':
      'Cart, Sale Order, and Reservation are not canonical aggregates.',
    'legacy-runtime-stack':
      'React Router v5, React Query v3, and styled-components are retired.',
    'superseded-experiments': 'Legacy checkout and experiment switches are retired.',
    'production-diagnostics-route':
      'The deliberate error is a scenario, not public production ingress.'
  },
  'PRD.md'
)

const deliveredSchedulingEntries: Readonly<
  Record<string, { readonly status: ParityStatus; readonly scenario: string }>
> = {
  'route:/book/:shopIdOrRoute/barber/:barberIdOrRoute/schedule': {
    status: 'verified',
    scenario: 'booking/scheduling-available'
  },
  'state:shop-any-provider': {
    status: 'verified',
    scenario: 'booking/scheduling-available'
  },
  'state:shop-specific-provider': {
    status: 'implemented',
    scenario: 'parity/state/shop-specific-provider'
  },
  'state:schedule-loading': {
    status: 'verified',
    scenario: 'booking/scheduling-loading'
  },
  'state:schedule-empty': {
    status: 'verified',
    scenario: 'booking/scheduling-empty'
  },
  'state:schedule-selected': {
    status: 'verified',
    scenario: 'booking/scheduling-available'
  },
  'state:hold-conflict': {
    status: 'verified',
    scenario: 'booking/scheduling-conflict'
  },
  'state:hold-expired': {
    status: 'verified',
    scenario: 'booking/scheduling-expiry-recovery'
  },
  'defect:schedule-unresolved-loading': {
    status: 'verified',
    scenario: 'booking/scheduling-loading'
  },
  'defect:schedule-empty-without-recovery': {
    status: 'verified',
    scenario: 'booking/scheduling-empty'
  }
}

export const fullParityLedger: ParityLedger = {
  version: 1,
  inventory,
  entries: entries.map((entry) => ({
    ...entry,
    ...deliveredSchedulingEntries[entry.inventoryId]
  }))
}
