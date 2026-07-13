import * as stylex from '@stylexjs/stylex'
import { AnimatePresence, LazyMotion, domAnimation, m } from 'motion/react'
import { useMemo, useState, type KeyboardEvent } from 'react'
import type {
  BookingJourney,
  ProviderPreference,
  PublicBookableService,
  ServiceSelection
} from '@b2b-saas-starter/capabilities/booking'
import { BookingVisualAsset } from '../assets/booking-visual-asset.tsx'
import { BookingPremiumThemeBoundary } from '../presentation/booking-premium-theme.tsx'
import {
  RoutePresence,
  RouteTitlePresence
} from '../presentation/booking-primitives.tsx'
import { styles } from './booking-flow.styles.ts'
import { BookingWidgetShell } from './booking-widget-shell.tsx'

type BookingSelectionFlowProps = {
  readonly journey: BookingJourney
  readonly busy: boolean
  readonly onChooseShop?: (shopId: string) => void
  readonly onChooseProvider: (preference: ProviderPreference) => void
  readonly onChooseServices: (selection: ServiceSelection) => void
  readonly onContinue?: () => void
  readonly onTitleActionMount?: (element: HTMLDivElement | null) => void
  readonly messages?: BookingSelectionMessages
}

function activateCard(
  event: KeyboardEvent<HTMLDivElement>,
  disabled: boolean,
  action: () => void
) {
  if (disabled || (event.key !== 'Enter' && event.key !== ' ')) return
  event.preventDefault()
  action()
}

export function BookingSelectionFlow(props: BookingSelectionFlowProps) {
  return (
    <BookingPremiumThemeBoundary
      palette={props.journey.resolvedConfiguration.premiumPalette}
    >
      <BookingSelectionFlowContent {...props} />
    </BookingPremiumThemeBoundary>
  )
}

function BookingSelectionFlowContent({
  journey,
  busy,
  onChooseShop,
  onChooseProvider,
  onChooseServices,
  onContinue,
  onTitleActionMount,
  messages = defaultMessages
}: BookingSelectionFlowProps) {
  const [editingProvider, setEditingProvider] = useState(false)
  const [pendingProviderChoice, setPendingProviderChoice] = useState<{
    readonly preference: ProviderPreference
    readonly journeyVersion: number
  } | null>(null)
  const [routeDirection, setRouteDirection] = useState<'forward' | 'back'>('forward')
  const [pendingShop, setPendingShop] = useState<{
    readonly id: string
    readonly afterVersion: number
  } | null>(null)
  const [orderOpen, setOrderOpen] = useState(false)
  const [titleScrollState, setTitleScrollState] = useState({
    presenceKey: '',
    scrolled: false
  })
  const shopSelectionConfirmed =
    pendingShop !== null &&
    journey.shopId === pendingShop.id &&
    journey.version > pendingShop.afterVersion
  const showLocations = journey.shops.length > 1 && !shopSelectionConfirmed
  const showProviders =
    !showLocations &&
    journey.presentation === 'team' &&
    journey.services.length > 0 &&
    (journey.providerPreference === null || editingProvider)
  const selectedPrimary = journey.services.find(
    (service) => service.id === journey.selection.primaryServiceId
  )

  const chooseProvider = (preference: ProviderPreference) => {
    setRouteDirection('forward')
    setPendingProviderChoice({ preference, journeyVersion: journey.version })
    setEditingProvider(false)
    onChooseProvider(preference)
  }

  const chooseShop = (shopId: string) => {
    setRouteDirection('forward')
    setPendingProviderChoice(null)
    setPendingShop({ id: shopId, afterVersion: journey.version })
    onChooseShop?.(shopId)
  }

  const pageTitle = showLocations
    ? messages.chooseLocation
    : showProviders
      ? messages.chooseProvider
      : messages.chooseService
  const canGoBack =
    (showProviders && journey.shops.length > 1) ||
    (!showLocations && !showProviders && journey.presentation === 'team')
  const routePresenceKey = showLocations
    ? 'locations'
    : showProviders
      ? 'providers'
      : 'services'
  const titleScrolled =
    titleScrollState.presenceKey === routePresenceKey && titleScrollState.scrolled

  return (
    <BookingWidgetShell>
      <div
        data-testid="container:title"
        {...stylex.props(styles.header, titleScrolled && styles.headerScrolled)}
      >
        <LazyMotion features={domAnimation} strict>
          <AnimatePresence initial>
            {canGoBack ? (
              <m.button
                type="button"
                aria-label="Back"
                data-testid="btn:back"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 24, opacity: 0.3 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.3, delay: 0.3 }}
                onClick={() => {
                  setRouteDirection('back')
                  if (journey.shops.length > 1 && showProviders) setPendingShop(null)
                  else setEditingProvider(true)
                }}
                {...stylex.props(styles.iconButton, styles.backButton)}
              >
                <BookingVisualAsset
                  assetRole="navigation-back"
                  {...stylex.props(styles.backIcon)}
                />
              </m.button>
            ) : null}
          </AnimatePresence>
        </LazyMotion>
        <RouteTitlePresence presenceKey={pageTitle}>
          <p {...stylex.props(styles.title)}>{pageTitle}</p>
        </RouteTitlePresence>
        {onTitleActionMount ? (
          <div ref={onTitleActionMount} {...stylex.props(styles.titleActions)} />
        ) : null}
      </div>

      <RoutePresence
        presenceKey={routePresenceKey}
        direction={routeDirection}
        className={stylex.props(styles.routeLayer).className}
      >
        <div {...stylex.props(styles.scrollableFrame)}>
          <div
            data-testid="container:scrollable"
            onScroll={(event) =>
              setTitleScrollState({
                presenceKey: routePresenceKey,
                scrolled: event.currentTarget.scrollTop > 0
              })
            }
            {...stylex.props(styles.main)}
          >
            <div aria-hidden="true" {...stylex.props(styles.scrollOrigin)} />
            <div {...stylex.props(styles.contentOffset)}>
              {!showLocations &&
              journey.resolvedConfiguration.shopName.isSourceLanguageFallback ? (
                <p {...stylex.props(styles.mutedSmall)}>{messages.sourceLanguage}</p>
              ) : null}
              {showLocations ? (
                <LocationGrid
                  journey={journey}
                  busy={busy || !onChooseShop}
                  messages={messages}
                  onChoose={chooseShop}
                />
              ) : showProviders ? (
                <ProviderGrid
                  journey={journey}
                  busy={busy}
                  selectedPreference={
                    pendingProviderChoice?.journeyVersion === journey.version
                      ? pendingProviderChoice.preference
                      : journey.providerPreference
                  }
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
            </div>
          </div>
        </div>
      </RoutePresence>

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
    </BookingWidgetShell>
  )
}

function LocationGrid({
  journey,
  busy,
  messages,
  onChoose
}: {
  readonly journey: BookingJourney
  readonly busy: boolean
  readonly messages: BookingSelectionMessages
  readonly onChoose: (shopId: string) => void
}) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [nearbyOrder, setNearbyOrder] = useState<readonly string[] | null>(null)
  const [locationStatus, setLocationStatus] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleShops = useMemo(() => {
    const matches = journey.shops.filter((shop) =>
      [shop.name, ...(shop.addressLines ?? [])]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalizedQuery)
    )
    if (!nearbyOrder) return matches
    const position = new Map(nearbyOrder.map((id, index) => [id, index]))
    return [...matches].sort(
      (left, right) =>
        (position.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (position.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    )
  }, [journey.shops, nearbyOrder, normalizedQuery])

  const findNearby = () => {
    if (!navigator.geolocation) {
      setLocationStatus(messages.nearbyUnavailable)
      return
    }
    setLocationStatus(messages.locating)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const ordered = journey.shops
          .filter((shop) => shop.coordinates)
          .map((shop) => ({
            id: shop.id,
            distance: distanceBetween(coords, shop.coordinates!)
          }))
          .sort((left, right) => left.distance - right.distance)
          .map(({ id }) => id)
        setNearbyOrder(ordered)
        setLocationStatus(
          ordered.length > 0 ? messages.nearbySorted : messages.nearbyUnavailable
        )
      },
      () => setLocationStatus(messages.nearbyUnavailable)
    )
  }

  return (
    <div>
      <div {...stylex.props(styles.locationActions)}>
        <button
          type="button"
          aria-label={messages.nearby}
          onClick={findNearby}
          {...stylex.props(styles.locationAction)}
        >
          <span>{messages.nearby}</span>
          <BookingVisualAsset
            assetRole="location-nearby"
            {...stylex.props(styles.icon16)}
          />
        </button>
        <button
          type="button"
          aria-label={messages.search}
          aria-expanded={searchOpen}
          onClick={() => setSearchOpen((open) => !open)}
          {...stylex.props(styles.locationAction)}
        >
          <span>{messages.search}</span>
          <BookingVisualAsset
            assetRole="location-search"
            {...stylex.props(styles.icon16)}
          />
        </button>
      </div>
      {searchOpen ? (
        <label {...stylex.props(styles.locationSearch)}>
          <span {...stylex.props(styles.srOnly)}>{messages.search}</span>
          <BookingVisualAsset
            assetRole="location-search"
            {...stylex.props(styles.icon16)}
          />
          <input
            type="search"
            value={query}
            placeholder={messages.search}
            onChange={(event) => setQuery(event.currentTarget.value)}
            {...stylex.props(styles.locationSearchInput)}
          />
        </label>
      ) : null}
      <output {...stylex.props(styles.srOnly)}>{locationStatus}</output>
      <div {...stylex.props(styles.locationList)}>
        {visibleShops.map((shop) => (
          <button
            key={shop.id}
            type="button"
            disabled={busy}
            aria-label={`${shop.name}${shop.addressLines?.length ? `, ${shop.addressLines.join(', ')}` : ''}`}
            onClick={() => onChoose(shop.id)}
            {...stylex.props(styles.locationCard)}
          >
            <span {...stylex.props(styles.locationImage)}>
              <BookingVisualAsset
                assetRole="booking-shop"
                {...stylex.props(styles.locationPlaceholder)}
              />
            </span>
            <span {...stylex.props(styles.locationCopy)}>
              <span {...stylex.props(styles.locationName)}>{shop.name}</span>
              {shop.addressLines?.map((line) => (
                <span key={line} {...stylex.props(styles.locationAddress)}>
                  {line}
                </span>
              ))}
              <span aria-hidden="true" {...stylex.props(styles.locationRule)} />
              {shop.localizedName?.isSourceLanguageFallback ? (
                <span {...stylex.props(styles.locationAddress)}>
                  {messages.sourceLanguage}
                </span>
              ) : null}
            </span>
          </button>
        ))}
        {visibleShops.length === 0 ? (
          <p {...stylex.props(styles.locationEmpty)}>{messages.noLocationMatches}</p>
        ) : null}
      </div>
    </div>
  )
}

function ProviderGrid({
  journey,
  busy,
  selectedPreference,
  onChoose,
  messages
}: {
  readonly journey: BookingJourney
  readonly busy: boolean
  readonly selectedPreference: ProviderPreference | null
  readonly onChoose: (preference: ProviderPreference) => void
  readonly messages: BookingSelectionMessages
}) {
  const publicProviderAvailable = journey.providers.some(
    (provider) => provider.access === 'public' && provider.eligibleServiceIds.length > 0
  )
  const anyProviderDisabled = busy || !publicProviderAvailable
  const anyProviderSelected = selectedPreference?.kind === 'any'
  return (
    <div {...stylex.props(styles.gridTwo)}>
      <div
        role="button"
        tabIndex={anyProviderDisabled ? -1 : 0}
        aria-disabled={anyProviderDisabled}
        aria-pressed={anyProviderSelected}
        aria-label={messages.anyProvider}
        data-testid="card:chooseServiceFirst"
        onClick={() => {
          if (!anyProviderDisabled) onChoose({ kind: 'any' })
        }}
        onKeyDown={(event) =>
          activateCard(event, anyProviderDisabled, () => onChoose({ kind: 'any' }))
        }
        {...stylex.props(
          styles.providerCard,
          anyProviderSelected && styles.providerCardSelected,
          busy && styles.providerCardBusy,
          !publicProviderAvailable && styles.providerCardDisabled
        )}
      >
        <div {...stylex.props(styles.avatar)}>
          <BookingVisualAsset
            assetRole="booking-party"
            {...stylex.props(styles.icon24)}
          />
        </div>
        <p {...stylex.props(styles.providerName)}>{messages.chooseService}</p>
        <p
          {...stylex.props(
            styles.providerAvailability,
            anyProviderSelected && styles.providerAvailabilitySelected
          )}
        >
          {messages.anyProvider}
        </p>
      </div>
      {journey.providers.map((provider) => {
        const disabled = busy || provider.access === 'restricted'
        const selected =
          selectedPreference?.kind === 'specific' &&
          selectedPreference.providerId === provider.id
        const choose = () =>
          onChoose({ kind: 'specific' as const, providerId: provider.id })
        return (
          <div
            key={provider.id}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            aria-pressed={selected}
            aria-label={`${provider.localizedName?.text ?? provider.displayName}, ${
              provider.access === 'restricted'
                ? messages.providerRestricted
                : messages.chooseProvider
            }`}
            data-testid={`card:barber:${provider.id}`}
            onClick={() => {
              if (!disabled) choose()
            }}
            onKeyDown={(event) => activateCard(event, disabled, choose)}
            {...stylex.props(
              styles.providerCard,
              selected && styles.providerCardSelected,
              busy && styles.providerCardBusy,
              provider.access === 'restricted' && styles.providerCardDisabled
            )}
          >
            <div {...stylex.props(styles.avatar)}>
              {initials(provider.localizedName?.text ?? provider.displayName)}
            </div>
            <p
              title={provider.localizedName?.text ?? provider.displayName}
              data-testid={`text:barberName:${provider.id}`}
              {...stylex.props(styles.providerName)}
            >
              {provider.localizedName?.text ?? provider.displayName}
            </p>
            <div
              data-testid={`divider:barber:${provider.id}`}
              {...stylex.props(styles.providerDivider)}
            />
            <p
              data-testid={`text:barberAvailability:${provider.id}`}
              {...stylex.props(
                styles.providerAvailability,
                selected && styles.providerAvailabilitySelected
              )}
            >
              {provider.access === 'restricted'
                ? messages.providerRestricted
                : messages.providerAvailable}
              {provider.localizedName?.isSourceLanguageFallback
                ? ` · ${messages.sourceLanguage}`
                : null}
            </p>
          </div>
        )
      })}
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
  readonly chooseLocation: string
  readonly chooseProvider: string
  readonly chooseService: string
  readonly shop: string
  readonly nearby: string
  readonly search: string
  readonly locating: string
  readonly nearbySorted: string
  readonly nearbyUnavailable: string
  readonly noLocationMatches: string
  readonly sourceLanguage: string
  readonly anyProvider: string
  readonly providerAvailable: string
  readonly providerRestricted: string
  readonly noServicesTitle: string
  readonly noServicesCopy: string
  readonly inactiveEntitiesCopy: string
  readonly invalidAssociationsCopy: string
}

const defaultMessages: BookingSelectionMessages = {
  chooseLocation: 'Choose a location',
  chooseProvider: 'Choose a professional',
  chooseService: 'What can we do for you?',
  shop: 'Shop',
  nearby: 'Nearby',
  search: 'Search',
  locating: 'Finding nearby locations…',
  nearbySorted: 'Locations are sorted by distance.',
  nearbyUnavailable: 'Nearby locations are unavailable.',
  noLocationMatches: 'No locations match your search.',
  sourceLanguage: 'Shown in the merchant’s original language',
  anyProvider: 'Book with any professional',
  providerAvailable: 'Available',
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

const distanceBetween = (
  origin: Pick<GeolocationCoordinates, 'latitude' | 'longitude'>,
  destination: { readonly latitude: number; readonly longitude: number }
) => {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const latitudeDelta = radians(destination.latitude - origin.latitude)
  const longitudeDelta = radians(destination.longitude - origin.longitude)
  const latitude1 = radians(origin.latitude)
  const latitude2 = radians(destination.latitude)
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * 6_371 * Math.asin(Math.sqrt(haversine))
}
