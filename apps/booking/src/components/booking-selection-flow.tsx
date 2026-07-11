import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import type {
  BookingJourney,
  ProviderPreference,
  PublicBookableService,
  ServiceSelection
} from '@b2b-saas-starter/capabilities/booking'
import { BookingVisualAsset } from '../assets/booking-visual-asset.tsx'
import { BookingPremiumThemeBoundary } from '../presentation/booking-premium-theme.tsx'
import { styles } from './booking-flow.styles.ts'

export function BookingSelectionFlow({
  journey,
  busy,
  onChooseShop,
  onChooseProvider,
  onChooseServices,
  onContinue,
  messages = defaultMessages
}: {
  readonly journey: BookingJourney
  readonly busy: boolean
  readonly onChooseShop?: (shopId: string) => void
  readonly onChooseProvider: (preference: ProviderPreference) => void
  readonly onChooseServices: (selection: ServiceSelection) => void
  readonly onContinue?: () => void
  readonly messages?: BookingSelectionMessages
}) {
  const [editingProvider, setEditingProvider] = useState(false)
  const [orderOpen, setOrderOpen] = useState(false)
  const showProviders =
    journey.presentation === 'team' &&
    journey.services.length > 0 &&
    (journey.providerPreference === null || editingProvider)
  const selectedPrimary = journey.services.find(
    (service) => service.id === journey.selection.primaryServiceId
  )

  const chooseProvider = (preference: ProviderPreference) => {
    setEditingProvider(false)
    onChooseProvider(preference)
  }

  return (
    <BookingPremiumThemeBoundary palette={journey.resolvedConfiguration.premiumPalette}>
      <div {...stylex.props(styles.app)} aria-busy={busy}>
        <div {...stylex.props(styles.widget)}>
          <header {...stylex.props(styles.header)}>
            <button
              type="button"
              aria-label="Back"
              disabled={showProviders}
              onClick={() => setEditingProvider(true)}
              {...stylex.props(
                styles.iconButton,
                styles.backButton,
                showProviders && styles.hidden
              )}
            >
              <BookingVisualAsset
                assetRole="navigation-back"
                {...stylex.props(styles.icon16)}
              />
            </button>
            <h1 {...stylex.props(styles.title)}>
              {showProviders ? messages.chooseProvider : messages.chooseService}
            </h1>
            <button
              type="button"
              aria-label="Booking menu"
              {...stylex.props(styles.iconButton)}
            >
              <BookingVisualAsset
                assetRole="navigation-menu"
                {...stylex.props(styles.icon16)}
              />
            </button>
          </header>

          <main {...stylex.props(styles.main)}>
            {journey.shops.length > 1 ? (
              <label>
                <span>{messages.shop}</span>
                <select
                  aria-label={messages.shop}
                  value={journey.shopId}
                  disabled={busy || !onChooseShop}
                  onChange={(event) => onChooseShop?.(event.currentTarget.value)}
                  {...stylex.props(styles.categoryButton)}
                >
                  {journey.shops.map((shop) => (
                    <option key={shop.id} value={shop.id}>
                      {shop.name}
                      {shop.localizedName?.isSourceLanguageFallback
                        ? ` — ${messages.sourceLanguage}`
                        : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {journey.resolvedConfiguration.shopName.isSourceLanguageFallback ? (
              <p {...stylex.props(styles.mutedSmall)}>{messages.sourceLanguage}</p>
            ) : null}
            {showProviders ? (
              <ProviderGrid
                journey={journey}
                busy={busy}
                messages={messages}
                onChoose={chooseProvider}
              />
            ) : (
              <ServiceGrid
                journey={journey}
                busy={busy}
                selectedPrimary={selectedPrimary}
                onChoose={onChooseServices}
                messages={messages}
              />
            )}
          </main>
        </div>

        {selectedPrimary && !showProviders ? (
          <button
            type="button"
            aria-label={`View order, ${formatPrice(total(journey), selectedPrimary.currency)}`}
            onClick={() => setOrderOpen(true)}
            {...stylex.props(styles.orderBar)}
          >
            <span>View order</span>
            <span {...stylex.props(styles.mono)}>
              {formatPrice(total(journey), selectedPrimary.currency)}
            </span>
          </button>
        ) : null}

        {orderOpen && selectedPrimary ? (
          <OrderSummary
            journey={journey}
            primary={selectedPrimary}
            onClose={() => setOrderOpen(false)}
            {...(onContinue ? { onContinue } : {})}
          />
        ) : null}
      </div>
    </BookingPremiumThemeBoundary>
  )
}

function ProviderGrid({
  journey,
  busy,
  onChoose,
  messages
}: {
  readonly journey: BookingJourney
  readonly busy: boolean
  readonly onChoose: (preference: ProviderPreference) => void
  readonly messages: BookingSelectionMessages
}) {
  const publicProviderAvailable = journey.providers.some(
    (provider) => provider.access === 'public' && provider.eligibleServiceIds.length > 0
  )
  return (
    <div {...stylex.props(styles.gridTwo)}>
      <button
        type="button"
        disabled={busy || !publicProviderAvailable}
        aria-label={messages.anyProvider}
        onClick={() => onChoose({ kind: 'any' })}
        {...stylex.props(styles.providerCard)}
      >
        <span {...stylex.props(styles.avatar)}>
          <BookingVisualAsset
            assetRole="booking-party"
            {...stylex.props(styles.icon24)}
          />
        </span>
        <span {...stylex.props(styles.providerName)}>{messages.chooseService}</span>
        <span {...stylex.props(styles.mutedSmall)}>{messages.anyProvider}</span>
      </button>
      {journey.providers.map((provider) => (
        <button
          key={provider.id}
          type="button"
          disabled={busy || provider.access === 'restricted'}
          onClick={() => onChoose({ kind: 'specific', providerId: provider.id })}
          {...stylex.props(styles.providerCard)}
        >
          <span {...stylex.props(styles.avatar)}>
            {initials(provider.localizedName?.text ?? provider.displayName)}
          </span>
          <span {...stylex.props(styles.providerName)}>
            {provider.localizedName?.text ?? provider.displayName}
          </span>
          <span {...stylex.props(styles.mutedSmall)}>
            {provider.access === 'restricted'
              ? messages.providerRestricted
              : messages.chooseProvider}
          </span>
          {provider.localizedName?.isSourceLanguageFallback ? (
            <span {...stylex.props(styles.mutedSmall)}>{messages.sourceLanguage}</span>
          ) : null}
        </button>
      ))}
    </div>
  )
}

function ServiceGrid({
  journey,
  busy,
  selectedPrimary,
  onChoose,
  messages
}: {
  readonly journey: BookingJourney
  readonly busy: boolean
  readonly selectedPrimary: PublicBookableService | undefined
  readonly onChoose: (selection: ServiceSelection) => void
  readonly messages: BookingSelectionMessages
}) {
  const [category, setCategory] = useState<string | null>(null)
  const eligible = eligibleServices(journey)
  if (eligible.length === 0) {
    return (
      <div {...stylex.props(styles.empty)}>
        <span {...stylex.props(styles.emptyIcon)}>
          <BookingVisualAsset
            assetRole="service-category"
            {...stylex.props(styles.icon20)}
          />
        </span>
        <h2 {...stylex.props(styles.emptyTitle)}>{messages.noServicesTitle}</h2>
        <p {...stylex.props(styles.emptyCopy)}>
          {journey.catalogRecovery === 'inactive_entities'
            ? messages.inactiveEntitiesCopy
            : journey.catalogRecovery === 'invalid_associations'
              ? messages.invalidAssociationsCopy
              : messages.noServicesCopy}
        </p>
      </div>
    )
  }

  if (selectedPrimary) {
    const additionalIds = new Set(journey.selection.additionalServiceIds)
    const compatibleAdditionalIds = new Set(journey.compatibleAdditionalServiceIds)
    const compatibleAdditions = eligible.filter(
      (service) =>
        service.id !== selectedPrimary.id && compatibleAdditionalIds.has(service.id)
    )
    return (
      <div>
        <button
          type="button"
          disabled={busy}
          aria-label={`Remove ${selectedPrimary.name}`}
          onClick={() => onChoose({ primaryServiceId: null, additionalServiceIds: [] })}
          {...stylex.props(styles.serviceCard, styles.selectedService)}
        >
          <ServiceContents service={selectedPrimary} selected messages={messages} />
          <span {...stylex.props(styles.selectionMark)}>
            <BookingVisualAsset
              assetRole="selection-check"
              {...stylex.props(styles.icon16)}
            />
          </span>
        </button>
        <h2 {...stylex.props(styles.sectionTitle)}>Anything you wish to add?</h2>
        <div {...stylex.props(styles.serviceGrid)}>
          {compatibleAdditions.map((service) => {
            const selected = additionalIds.has(service.id)
            return (
              <button
                key={service.id}
                type="button"
                disabled={busy}
                aria-label={`${service.name}${selected ? ', selected' : ''}`}
                onClick={() =>
                  onChoose({
                    primaryServiceId: selectedPrimary.id,
                    additionalServiceIds: selected
                      ? journey.selection.additionalServiceIds.filter(
                          (id) => id !== service.id
                        )
                      : [...journey.selection.additionalServiceIds, service.id]
                  })
                }
                {...stylex.props(styles.serviceCard, selected && styles.selectedAddon)}
              >
                <ServiceContents service={service} messages={messages} />
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  const categories = [
    ...new Set(
      eligible.map((service) => service.category).filter((value) => value !== null)
    )
  ]
  const visibleServices =
    category === null
      ? eligible
      : eligible.filter((service) => service.category === category)
  const categoryValue =
    category === null ? 'all' : `category:${categories.indexOf(category)}`

  return (
    <div>
      <select
        aria-label="Service category"
        value={categoryValue}
        onChange={(event) => {
          const value = event.currentTarget.value
          setCategory(
            value === 'all'
              ? null
              : (categories[Number(value.slice('category:'.length))] ?? null)
          )
        }}
        {...stylex.props(styles.categoryButton)}
      >
        <option value="all">All categories</option>
        {categories.map((item, index) => (
          <option key={item} value={`category:${index}`}>
            {item}
          </option>
        ))}
      </select>
      <div {...stylex.props(styles.serviceGrid)}>
        {visibleServices.map((service) => (
          <button
            key={service.id}
            type="button"
            disabled={busy}
            aria-label={service.name}
            onClick={() =>
              onChoose({ primaryServiceId: service.id, additionalServiceIds: [] })
            }
            {...stylex.props(styles.serviceCard)}
          >
            <ServiceContents service={service} messages={messages} />
          </button>
        ))}
      </div>
    </div>
  )
}

export type BookingSelectionMessages = {
  readonly chooseProvider: string
  readonly chooseService: string
  readonly shop: string
  readonly sourceLanguage: string
  readonly anyProvider: string
  readonly providerRestricted: string
  readonly noServicesTitle: string
  readonly noServicesCopy: string
  readonly inactiveEntitiesCopy: string
  readonly invalidAssociationsCopy: string
}

const defaultMessages: BookingSelectionMessages = {
  chooseProvider: 'Choose a professional',
  chooseService: 'What can we do for you?',
  shop: 'Shop',
  sourceLanguage: 'Shown in the merchant’s original language',
  anyProvider: 'Book with any professional',
  providerRestricted: 'This professional requires private access',
  noServicesTitle: 'No services are bookable',
  noServicesCopy:
    'There are no active services available for your professional choice.',
  inactiveEntitiesCopy:
    'Previously available professionals or services are no longer active. Choose another option.',
  invalidAssociationsCopy:
    'The available professionals and services cannot currently be booked together.'
}

function ServiceContents({
  service,
  selected = false,
  messages
}: {
  readonly service: PublicBookableService
  readonly selected?: boolean
  readonly messages: BookingSelectionMessages
}) {
  return (
    <>
      <span {...stylex.props(styles.serviceName)}>{service.name}</span>
      {service.localizedName?.isSourceLanguageFallback ? (
        <span {...stylex.props(styles.mutedSmall)}>{messages.sourceLanguage}</span>
      ) : null}
      <span
        {...stylex.props(
          styles.serviceDuration,
          selected && styles.selectedServiceDuration
        )}
      >
        {service.durationMinutes} min
      </span>
      <span {...stylex.props(styles.pricePill, selected && styles.selectedPricePill)}>
        {formatPrice(service.priceMinor, service.currency)}
      </span>
    </>
  )
}

function OrderSummary({
  journey,
  primary,
  onClose,
  onContinue
}: {
  readonly journey: BookingJourney
  readonly primary: PublicBookableService
  readonly onClose: () => void
  readonly onContinue?: () => void
}) {
  const additions = journey.selection.additionalServiceIds
    .map((id) => journey.services.find((service) => service.id === id))
    .filter((service): service is PublicBookableService => service !== undefined)
  return (
    <dialog open aria-label="Order summary" {...stylex.props(styles.drawer)}>
      <div {...stylex.props(styles.drawerHeader)}>
        <div>
          <h2 {...stylex.props(styles.drawerTitle)}>Your order</h2>
          <p {...stylex.props(styles.drawerSubtitle)}>Booking Session</p>
        </div>
        <button
          type="button"
          aria-label="Close order summary"
          onClick={onClose}
          {...stylex.props(styles.iconButton, styles.darkIconButton)}
        >
          <BookingVisualAsset assetRole="dismiss" {...stylex.props(styles.icon16)} />
        </button>
      </div>
      <div {...stylex.props(styles.orderCard)}>
        <div {...stylex.props(styles.rowBetween)}>
          <div>
            <p {...stylex.props(styles.orderProvider)}>{providerLabel(journey)}</p>
            <p {...stylex.props(styles.orderMuted)}>{primary.name}</p>
          </div>
          <strong {...stylex.props(styles.mono)}>
            {formatPrice(primary.priceMinor, primary.currency)}
          </strong>
        </div>
        {additions.map((service) => (
          <div key={service.id} {...stylex.props(styles.orderLine)}>
            <span>{service.name}</span>
            <span {...stylex.props(styles.mono)}>
              {formatPrice(service.priceMinor, service.currency)}
            </span>
          </div>
        ))}
      </div>
      <div {...stylex.props(styles.drawerFooter)}>
        <div {...stylex.props(styles.subtotal)}>
          <span>Subtotal</span>
          <span {...stylex.props(styles.mono)}>
            {formatPrice(total(journey), primary.currency)}
          </span>
        </div>
        <button
          type="button"
          disabled={!onContinue}
          onClick={() => {
            onClose()
            onContinue?.()
          }}
          {...stylex.props(styles.primaryButton, styles.drawerButton)}
        >
          Choose time
        </button>
      </div>
    </dialog>
  )
}

const eligibleServices = (journey: BookingJourney) => {
  const preference = journey.providerPreference
  if (preference?.kind === 'any') {
    const publicProviderIds = new Set(
      journey.providers
        .filter((provider) => provider.access === 'public')
        .map((provider) => provider.id)
    )
    return journey.services.filter((service) =>
      service.eligibleProviderIds.some((providerId) =>
        publicProviderIds.has(providerId)
      )
    )
  }
  if (preference?.kind !== 'specific') return journey.services
  return journey.services.filter((service) =>
    service.eligibleProviderIds.includes(preference.providerId)
  )
}
const providerLabel = (journey: BookingJourney) => {
  const preference = journey.providerPreference
  return preference?.kind === 'any'
    ? 'Any professional'
    : (journey.providers.find(
        (provider) =>
          provider.id ===
          (preference?.kind === 'specific' ? preference.providerId : null)
      )?.displayName ?? 'Professional')
}
const total = (journey: BookingJourney) => {
  const ids = new Set([
    journey.selection.primaryServiceId,
    ...journey.selection.additionalServiceIds
  ])
  return journey.services
    .filter((service) => ids.has(service.id))
    .reduce((sum, service) => sum + service.priceMinor, 0)
}
const formatPrice = (amountMinor: number, currency: string) =>
  (amountMinor / 100).toLocaleString('en-US', {
    style: 'currency',
    currency
  })
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
