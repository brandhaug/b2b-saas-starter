import * as stylex from '@stylexjs/stylex'
import {
  AnimatePresence,
  LazyMotion,
  domAnimation,
  m,
  useReducedMotion
} from 'motion/react'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import type {
  BookingJourney,
  ProviderPreference,
  PublicBookableService,
  ServiceSelection,
  TimeSlotHold
} from '@b2b-saas-starter/capabilities/booking'
import { BookingVisualAsset } from '../assets/booking-visual-asset.tsx'
import { BookingPremiumThemeBoundary } from '../presentation/booking-premium-theme.tsx'
import type { BookingLocale } from '../localization/booking-localization.ts'
import { formatProviderAvailability } from '../presentation/provider-availability-format.ts'
import {
  RoutePresence,
  RouteTitlePresence
} from '../presentation/booking-primitives.tsx'
import { styles } from './booking-flow.styles.ts'
import { BookingWidgetShell } from './booking-widget-shell.tsx'

type BookingSelectionFlowProps = {
  readonly journey: BookingJourney
  readonly busy: boolean
  readonly initialPage?: 'locations' | 'providers' | 'services'
  readonly onNavigateBack?: (page: 'locations' | 'providers') => void
  readonly onChooseShop?: (shopId: string) => void
  readonly onChooseProvider: (preference: ProviderPreference) => void
  readonly onChooseServices: (selection: ServiceSelection) => void
  readonly onChooseGiftCard?: () => void
  readonly locale?: BookingLocale
  readonly onContinue?: () => void
  readonly onTitleActionMount?: (element: HTMLDivElement | null) => void
  readonly messages?: BookingSelectionMessages
  readonly continuation?: {
    readonly title: string
    readonly content: ReactNode
    readonly busy: boolean
    readonly busyLabel: string
    readonly onBack: () => void
    readonly heldOrder?: {
      readonly action: () => void
      readonly ctaLabel: string
      readonly continueLabel: string
      readonly quote: TimeSlotHold['quote']
      readonly timeZone: string
    }
  }
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
  onChooseGiftCard,
  onContinue,
  initialPage,
  onNavigateBack,
  onTitleActionMount,
  continuation,
  locale = 'en',
  messages = defaultMessages
}: BookingSelectionFlowProps) {
  const [editingProvider, setEditingProvider] = useState(initialPage === 'providers')
  const [editingLocation, setEditingLocation] = useState(
    initialPage === undefined || initialPage === 'locations'
  )
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
  const [giftCardSelected, setGiftCardSelected] = useState(false)
  const giftCardTimer = useRef<number | null>(null)
  const [pendingServiceSelection, setPendingServiceSelection] = useState<{
    readonly serviceId: string
    readonly journeyVersion: number
  } | null>(null)
  const serviceTransitionTimer = useRef<number | null>(null)
  const serviceMutationBusySeen = useRef(false)
  const viewOrderButton = useRef<HTMLButtonElement | null>(null)
  const [titleScrollState, setTitleScrollState] = useState({
    presenceKey: '',
    scrolled: false
  })
  const shopSelectionConfirmed =
    pendingShop !== null &&
    journey.shopId === pendingShop.id &&
    journey.version > pendingShop.afterVersion
  const showLocations =
    journey.shops.length > 1 && editingLocation && !shopSelectionConfirmed
  const providerChoicePending =
    pendingProviderChoice?.journeyVersion === journey.version
  const showProviders =
    !showLocations &&
    journey.presentation === 'team' &&
    journey.services.length > 0 &&
    (journey.providerPreference === null || editingProvider || providerChoicePending)
  const selectedPrimary = journey.services.find(
    (service) => service.id === journey.selection.primaryServiceId
  )
  const showContinuation = continuation !== undefined
  const heldOrder = continuation?.heldOrder
  const orderCtaLabel = heldOrder?.ctaLabel ?? 'View order'
  const displayedOrderTotal = heldOrder?.quote.totalMinor ?? total(journey)

  useEffect(
    () => () => {
      if (giftCardTimer.current !== null) window.clearTimeout(giftCardTimer.current)
      if (serviceTransitionTimer.current !== null)
        window.clearTimeout(serviceTransitionTimer.current)
    },
    []
  )

  useEffect(() => {
    if (
      !pendingServiceSelection ||
      journey.version <= pendingServiceSelection.journeyVersion ||
      journey.selection.primaryServiceId !== pendingServiceSelection.serviceId
    )
      return
    if (serviceTransitionTimer.current !== null)
      window.clearTimeout(serviceTransitionTimer.current)
    serviceTransitionTimer.current = window.setTimeout(() => {
      setPendingServiceSelection(null)
      serviceTransitionTimer.current = null
    }, 100)
    return () => {
      if (serviceTransitionTimer.current !== null) {
        window.clearTimeout(serviceTransitionTimer.current)
        serviceTransitionTimer.current = null
      }
    }
  }, [journey.selection.primaryServiceId, journey.version, pendingServiceSelection])

  useEffect(() => {
    if (!pendingServiceSelection) {
      serviceMutationBusySeen.current = false
      return
    }
    if (busy) {
      serviceMutationBusySeen.current = true
      return
    }
    if (
      serviceMutationBusySeen.current &&
      !(
        journey.version > pendingServiceSelection.journeyVersion &&
        journey.selection.primaryServiceId === pendingServiceSelection.serviceId
      )
    )
      setPendingServiceSelection(null)
  }, [
    busy,
    journey.selection.primaryServiceId,
    journey.version,
    pendingServiceSelection
  ])

  const closeOrder = () => {
    setOrderOpen(false)
    window.setTimeout(() => viewOrderButton.current?.focus({ preventScroll: true }), 0)
  }

  const continueToScheduling = () => {
    setRouteDirection('forward')
    onContinue?.()
  }

  const chooseGiftCard = () => {
    if (!onChooseGiftCard || giftCardSelected) return
    setGiftCardSelected(true)
    giftCardTimer.current = window.setTimeout(onChooseGiftCard, 300)
  }

  const chooseProvider = (preference: ProviderPreference) => {
    setRouteDirection('forward')
    setPendingProviderChoice({ preference, journeyVersion: journey.version })
    setEditingProvider(false)
    onChooseProvider(preference)
  }

  const chooseShop = (shopId: string) => {
    setRouteDirection('forward')
    setEditingLocation(false)
    setPendingProviderChoice(null)
    setPendingShop({ id: shopId, afterVersion: journey.version })
    onChooseShop?.(shopId)
  }

  const pageTitle = showContinuation
    ? continuation.title
    : showLocations
      ? messages.chooseLocation
      : showProviders
        ? messages.chooseProvider
        : messages.chooseService
  const canGoBack =
    showContinuation ||
    (showProviders && journey.shops.length > 1) ||
    (!showLocations && !showProviders && journey.presentation === 'team')
  const routePresenceKey = showContinuation
    ? 'scheduling'
    : showLocations
      ? 'locations'
      : showProviders
        ? 'providers'
        : 'services'
  const titleScrolled =
    titleScrollState.presenceKey === routePresenceKey && titleScrollState.scrolled

  return (
    <BookingWidgetShell
      busy={continuation?.busy ?? false}
      {...(continuation ? { busyLabel: continuation.busyLabel } : {})}
    >
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
                  if (continuation) {
                    continuation.onBack()
                    return
                  }
                  setPendingProviderChoice(null)
                  if (journey.shops.length > 1 && showProviders) {
                    setPendingShop(null)
                    setEditingLocation(true)
                    onNavigateBack?.('locations')
                  } else {
                    setEditingProvider(true)
                    onNavigateBack?.('providers')
                  }
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
        {showContinuation ? (
          continuation.content
        ) : (
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
                      providerChoicePending ? pendingProviderChoice.preference : null
                    }
                    messages={messages}
                    onChoose={chooseProvider}
                    locale={locale}
                    giftCardSelected={giftCardSelected}
                    {...(onChooseGiftCard ? { onChooseGiftCard: chooseGiftCard } : {})}
                  />
                ) : (
                  <AnimatePresence mode="wait" initial={false}>
                    <ServiceGrid
                      key={
                        selectedPrimary && !pendingServiceSelection
                          ? 'addonsFade'
                          : 'servicesFade'
                      }
                      journey={journey}
                      busy={busy}
                      selectedPrimary={selectedPrimary}
                      transitioningServiceId={
                        pendingServiceSelection?.serviceId ?? null
                      }
                      onChoose={(selection) => {
                        if (
                          selection.primaryServiceId &&
                          journey.selection.primaryServiceId === null
                        )
                          setPendingServiceSelection({
                            serviceId: selection.primaryServiceId,
                            journeyVersion: journey.version
                          })
                        onChooseServices(selection)
                      }}
                      messages={messages}
                    />
                  </AnimatePresence>
                )}
              </div>
            </div>
          </div>
        )}
      </RoutePresence>

      <LazyMotion features={domAnimation} strict>
        <div {...stylex.props(styles.orderBarFixed)}>
          <AnimatePresence>
            {selectedPrimary && !showProviders && !orderOpen ? (
              <m.div
                key="viewOrderSafeArea"
                data-testid="container:viewOrderSafeArea"
                role="button"
                aria-label="Open order"
                onClick={() => setOrderOpen(true)}
                initial={{ scale: 0.8, bottom: -88 }}
                animate={{ scale: 1, bottom: 0 }}
                exit={{
                  scale: 0.8,
                  bottom: -88,
                  transition: { duration: 0.15, delay: 0.15, ease: 'easeInOut' }
                }}
                transition={{
                  duration: 0.2,
                  delay: 0.2,
                  ease: 'easeInOut'
                }}
                {...stylex.props(styles.orderBarSafeArea)}
              >
                <button
                  ref={viewOrderButton}
                  type="button"
                  data-testid="btn:viewOrder"
                  data-order-state={heldOrder ? 'checkout' : 'viewOrder'}
                  aria-label={`${orderCtaLabel}, ${formatPrice(
                    displayedOrderTotal,
                    heldOrder?.quote.currency ?? selectedPrimary.currency
                  )}`}
                  {...stylex.props(
                    styles.orderBar,
                    heldOrder && styles.orderBarCheckout
                  )}
                >
                  <span>{orderCtaLabel}</span>
                  <span {...stylex.props(styles.orderBarTotal)}>
                    {formatPrice(
                      displayedOrderTotal,
                      heldOrder?.quote.currency ?? selectedPrimary.currency
                    )}
                  </span>
                </button>
              </m.div>
            ) : null}
          </AnimatePresence>
        </div>
        <AnimatePresence>
          {orderOpen && selectedPrimary ? (
            <OrderSummary
              key="styledBookingCart"
              journey={journey}
              primary={selectedPrimary}
              locale={locale}
              messages={messages}
              onClose={closeOrder}
              {...(heldOrder ? { quote: heldOrder.quote } : {})}
              {...(heldOrder ? { timeZone: heldOrder.timeZone } : {})}
              {...(heldOrder
                ? { onContinue: heldOrder.action }
                : onContinue
                  ? { onContinue: continueToScheduling }
                  : {})}
              {...(heldOrder ? { continueLabel: heldOrder.continueLabel } : {})}
            />
          ) : null}
        </AnimatePresence>
      </LazyMotion>
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
  onChooseGiftCard,
  messages,
  locale,
  giftCardSelected
}: {
  readonly journey: BookingJourney
  readonly busy: boolean
  readonly selectedPreference: ProviderPreference | null
  readonly onChoose: (preference: ProviderPreference) => void
  readonly onChooseGiftCard?: () => void
  readonly messages: BookingSelectionMessages
  readonly locale: BookingLocale
  readonly giftCardSelected: boolean
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
        <BookingVisualAsset
          assetRole="any-provider-selection"
          {...stylex.props(styles.anyProviderIcon)}
        />
        <p
          data-testid="text:chooseServiceFirst:mainText"
          {...stylex.props(styles.anyProviderTitle)}
        >
          {messages.providerCards.anyProvider.titleLines[0]}
          <br />
          {messages.providerCards.anyProvider.titleLines[1]}
        </p>
        <p
          data-testid="text:chooseServiceFirst:subText"
          {...stylex.props(
            styles.cardSmallText,
            styles.anyProviderSubtitle,
            anyProviderSelected && styles.providerAvailabilitySelected
          )}
        >
          {messages.providerCards.anyProvider.subtitleLines[0]}
          <br />
          {messages.providerCards.anyProvider.subtitleLines[1]}
        </p>
      </div>
      {journey.providers.map((provider) => {
        const disabled =
          busy || provider.access === 'restricted' || provider.nextAvailableAt === null
        const displayName = provider.localizedName?.text ?? provider.displayName
        const shortName = provider.shortName
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
            aria-label={`${shortName}, ${
              provider.access === 'restricted'
                ? messages.providerRestricted
                : provider.nextAvailableAt === null
                  ? messages.providerNotAvailable
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
              (provider.access === 'restricted' || provider.nextAvailableAt === null) &&
                styles.providerCardDisabled
            )}
          >
            <div
              data-testid={`avatar:barber:${provider.id}`}
              {...stylex.props(styles.avatar)}
            >
              <div
                {...stylex.props(
                  styles.avatarReplacement,
                  selected && styles.avatarReplacementSelected
                )}
              >
                <p {...stylex.props(styles.avatarInitials)}>{initials(displayName)}</p>
              </div>
            </div>
            <p
              title={shortName}
              data-testid={`text:barberName:${provider.id}`}
              {...stylex.props(styles.providerName, styles.providerNameEllipsis)}
            >
              {shortName}
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
                : provider.nextAvailableAt === null
                  ? messages.providerNotAvailable
                  : messages.providerAvailable}
              {provider.access === 'restricted' || !provider.nextAvailableAt ? null : (
                <>
                  <br />
                  {formatProviderAvailability(
                    provider.nextAvailableAt,
                    journey.shops.find((shop) => shop.id === journey.shopId)
                      ?.timezone ?? 'UTC',
                    locale
                  )}
                </>
              )}
              {provider.localizedName?.isSourceLanguageFallback
                ? ` · ${messages.sourceLanguage}`
                : null}
            </p>
          </div>
        )
      })}
      {journey.canSellUnassignedGiftCard && onChooseGiftCard ? (
        <div
          role="button"
          tabIndex={busy ? -1 : 0}
          aria-disabled={busy}
          aria-pressed={giftCardSelected}
          aria-label={messages.providerCards.giftCard.titleLines.join(' ')}
          data-testid="card:buyGiftCard"
          onClick={() => {
            if (!busy) onChooseGiftCard()
          }}
          onKeyDown={(event) => activateCard(event, busy, onChooseGiftCard)}
          {...stylex.props(
            styles.providerCard,
            styles.providerCardVisible,
            giftCardSelected && styles.providerCardSelected,
            busy && styles.providerCardBusy
          )}
        >
          <BookingVisualAsset
            assetRole="gift-card-selection"
            {...stylex.props(styles.giftCardIcon)}
          />
          <p data-testid="text:title" {...stylex.props(styles.giftCardTitle)}>
            {messages.providerCards.giftCard.titleLines[0]}
            <br />
            {messages.providerCards.giftCard.titleLines[1]}
          </p>
          <p
            data-testid="text:subtitle"
            {...stylex.props(
              styles.cardSmallText,
              styles.giftCardSubtitle,
              giftCardSelected && styles.providerAvailabilitySelected
            )}
          >
            {messages.providerCards.giftCard.subtitleLines[0]}
            <br />
            {messages.providerCards.giftCard.subtitleLines[1]}
          </p>
        </div>
      ) : null}
    </div>
  )
}

type ServiceCategoryFilter =
  | { readonly kind: 'all' }
  | { readonly kind: 'uncategorized' }
  | { readonly kind: 'category'; readonly value: string }

function ServiceGrid({
  journey,
  busy,
  selectedPrimary,
  transitioningServiceId,
  onChoose,
  messages
}: {
  readonly journey: BookingJourney
  readonly busy: boolean
  readonly selectedPrimary: PublicBookableService | undefined
  readonly transitioningServiceId: string | null
  readonly onChoose: (selection: ServiceSelection) => void
  readonly messages: BookingSelectionMessages
}) {
  const [category, setCategory] = useState<ServiceCategoryFilter>({ kind: 'all' })
  const eligible = eligibleServices(journey)
  const categories = [
    ...new Set(
      eligible.map((service) => service.category).filter((value) => value !== null)
    )
  ]
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

  if (selectedPrimary && !transitioningServiceId) {
    const additionalIds = new Set(journey.selection.additionalServiceIds)
    const compatibleAdditionalIds = new Set(journey.compatibleAdditionalServiceIds)
    const compatibleAdditions = eligible.filter(
      (service) =>
        service.id !== selectedPrimary.id && compatibleAdditionalIds.has(service.id)
    )
    return (
      <m.div
        key="addonsFade"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
      >
        <LegacyServiceCard
          service={selectedPrimary}
          selected
          confirmed
          busy={busy}
          messages={messages}
          onClick={() => onChoose({ primaryServiceId: null, additionalServiceIds: [] })}
        />
        <h2 {...stylex.props(styles.sectionTitle)}>Anything you wish to add?</h2>
        <div {...stylex.props(styles.serviceGrid)}>
          {compatibleAdditions.map((service) => {
            const selected = additionalIds.has(service.id)
            return (
              <LegacyServiceCard
                key={service.id}
                service={service}
                selected={selected}
                addon
                busy={busy}
                messages={messages}
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
              />
            )
          })}
        </div>
      </m.div>
    )
  }

  const visibleServices =
    category.kind === 'all'
      ? eligible
      : category.kind === 'uncategorized'
        ? eligible.filter((service) => service.category === null)
        : eligible.filter((service) => service.category === category.value)
  return (
    <m.div
      key="servicesFade"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      {categories.length > 0 ? (
        <ServiceCategorySelect
          categories={categories}
          value={category}
          onChange={setCategory}
          messages={messages}
        />
      ) : null}
      <div
        {...stylex.props(
          styles.serviceGrid,
          categories.length === 0 && styles.serviceGridWithoutCategory
        )}
      >
        {visibleServices.map((service) => (
          <LegacyServiceCard
            key={service.id}
            service={service}
            selected={transitioningServiceId === service.id}
            busy={busy}
            messages={messages}
            onClick={() =>
              onChoose({ primaryServiceId: service.id, additionalServiceIds: [] })
            }
          />
        ))}
      </div>
    </m.div>
  )
}

function ServiceCategorySelect({
  categories,
  value,
  onChange,
  messages
}: {
  readonly categories: readonly string[]
  readonly value: ServiceCategoryFilter
  readonly onChange: (value: ServiceCategoryFilter) => void
  readonly messages: BookingSelectionMessages
}) {
  const [expanded, setExpanded] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const optionsId = useId()
  const reduceMotion = useReducedMotion()
  const selectedLabel =
    value.kind === 'all'
      ? messages.allCategories
      : value.kind === 'uncategorized'
        ? messages.uncategorized
        : value.value
  const options: readonly {
    readonly key: string
    readonly value: ServiceCategoryFilter
    readonly label: string
  }[] = [
    { key: 'category:all', value: { kind: 'all' }, label: messages.allCategories },
    ...categories.map((category) => ({
      key: `category:${category}`,
      value: { kind: 'category' as const, value: category },
      label: category
    })),
    {
      key: 'category:uncategorized',
      value: { kind: 'uncategorized' },
      label: messages.uncategorized
    }
  ]
  const toggle = () => setExpanded((current) => !current)
  const closeAndFocus = () => {
    setExpanded(false)
    triggerRef.current?.focus()
  }

  return (
    <div {...stylex.props(styles.categorySpaceTaker)}>
      <svg
        aria-hidden="true"
        width="12"
        height="6"
        viewBox="0 0 12 6"
        onClick={toggle}
        {...stylex.props(
          styles.categoryStateArrow,
          expanded && styles.categoryStateArrowExpanded
        )}
      >
        <path
          d="M6 5.992a.75.75 0 0 0 .545-.246l4.453-4.559a.667.667 0 0 0 .2-.486.69.69 0 0 0-.692-.697.715.715 0 0 0-.504.21L6.006 4.323 1.998.215a.73.73 0 0 0-.504-.211A.69.69 0 0 0 .803.7c0 .194.07.358.199.487L5.46 5.745A.725.725 0 0 0 6 5.992Z"
          fill="currentColor"
        />
      </svg>
      <m.div
        data-testid="select:categories"
        initial={false}
        animate={{ height: expanded ? 'auto' : 46 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.15 }}
        onClick={toggle}
        {...stylex.props(
          styles.categorySelect,
          !expanded && styles.categorySelectCollapsed,
          value.kind !== 'all' && !expanded && styles.categorySelectChosen,
          expanded && styles.categorySelectExpanded
        )}
      >
        <div
          ref={triggerRef}
          role="button"
          tabIndex={0}
          aria-label={messages.serviceCategory}
          aria-expanded={expanded}
          aria-controls={optionsId}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setExpanded(false)
              return
            }
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            toggle()
          }}
        >
          <p
            data-testid="text:category"
            {...stylex.props(
              styles.categorySelectedText,
              value.kind !== 'all' && styles.categorySelectedTextChosen
            )}
          >
            {selectedLabel}
          </p>
        </div>
        <div
          id={optionsId}
          aria-hidden={!expanded}
          {...(!expanded ? { inert: true } : {})}
        >
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              tabIndex={expanded ? 0 : -1}
              data-testid={option.key}
              onClick={(event) => {
                event.stopPropagation()
                onChange(option.value)
                closeAndFocus()
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                event.preventDefault()
                closeAndFocus()
              }}
              {...stylex.props(styles.categoryOption)}
            >
              <p {...stylex.props(styles.categoryOptionText)}>{option.label}</p>
            </button>
          ))}
        </div>
      </m.div>
    </div>
  )
}

type LegacyCardCopy = {
  readonly titleLines: readonly [string, string]
  readonly subtitleLines: readonly [string, string]
}

export type BookingSelectionMessages = {
  readonly chooseLocation: string
  readonly chooseProvider: string
  readonly chooseService: string
  readonly allCategories: string
  readonly uncategorized: string
  readonly serviceCategory: string
  readonly chooseServiceFirst: string
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
  readonly providerNotAvailable: string
  readonly providerRestricted: string
  readonly appointmentAt: string
  readonly durationMinutesShort: string
  readonly providerCards: {
    readonly anyProvider: LegacyCardCopy
    readonly giftCard: LegacyCardCopy
  }
  readonly noServicesTitle: string
  readonly noServicesCopy: string
  readonly inactiveEntitiesCopy: string
  readonly invalidAssociationsCopy: string
}

const defaultMessages: BookingSelectionMessages = {
  chooseLocation: 'Choose a location',
  chooseProvider: 'Choose a professional',
  chooseService: 'Choose a service',
  allCategories: 'All categories',
  uncategorized: 'Uncategorized',
  serviceCategory: 'Service category',
  chooseServiceFirst: 'Choose a service first',
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
  providerNotAvailable: 'Not available',
  providerRestricted: 'This professional requires private access',
  appointmentAt: 'at',
  durationMinutesShort: 'min',
  providerCards: {
    anyProvider: {
      titleLines: ['Choose a', 'service first'],
      subtitleLines: ['Book with any', 'professional']
    },
    giftCard: {
      titleLines: ['Buy a gift', 'card instead'],
      subtitleLines: ['Give the gift', 'of grooming']
    }
  },
  noServicesTitle: 'No services are bookable',
  noServicesCopy:
    'There are no active services available for your professional choice.',
  inactiveEntitiesCopy:
    'Previously available professionals or services are no longer active. Choose another option.',
  invalidAssociationsCopy:
    'The available professionals and services cannot currently be booked together.'
}

function LegacyServiceCard({
  service,
  selected = false,
  confirmed = false,
  addon = false,
  busy,
  onClick,
  messages
}: {
  readonly service: PublicBookableService
  readonly selected?: boolean
  readonly confirmed?: boolean
  readonly addon?: boolean
  readonly busy: boolean
  readonly onClick: () => void
  readonly messages: BookingSelectionMessages
}) {
  return (
    <m.div
      initial={confirmed ? { opacity: 0, scale: 0.8 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: confirmed ? 0.3 : 0 }}
      {...(confirmed ? { exit: { opacity: 0, scale: 0.8 } } : {})}
      {...stylex.props(
        styles.serviceCardSpace,
        confirmed && styles.confirmedServiceCardSpace
      )}
    >
      <div
        role="button"
        tabIndex={busy ? -1 : 0}
        data-testid={`service:${service.id}`}
        data-auto-selected={selected}
        aria-disabled={busy}
        aria-pressed={selected}
        aria-label={
          selected && (confirmed || addon) ? `Remove ${service.name}` : service.name
        }
        onClick={() => {
          if (!busy) onClick()
        }}
        onKeyDown={(event) => activateCard(event, busy, onClick)}
        {...stylex.props(
          styles.serviceCard,
          selected && styles.selectedService,
          addon && selected && styles.selectedAddon,
          busy && styles.serviceCardBusy
        )}
      >
        <p
          data-testid="text:name"
          {...stylex.props(
            styles.serviceName,
            selected && !addon && styles.selectedServiceName
          )}
        >
          {service.name}
        </p>
        {service.localizedName?.isSourceLanguageFallback ? (
          <p {...stylex.props(styles.mutedSmall)}>{messages.sourceLanguage}</p>
        ) : null}
        <p
          data-testid="text:duration"
          {...stylex.props(
            styles.serviceDuration,
            selected && !addon && styles.selectedServiceDuration
          )}
        >
          {service.durationMinutes} min
        </p>
        <m.div
          data-testid="text:description"
          initial={false}
          animate={{ height: 0, opacity: 0 }}
          {...stylex.props(styles.serviceDescription)}
        />
        <p
          data-testid="text:price"
          {...stylex.props(
            styles.pricePill,
            selected && !addon && styles.selectedPricePill,
            selected && addon && styles.selectedAddonPricePill
          )}
        >
          {formatPrice(service.priceMinor, service.currency)}
        </p>
        {confirmed ? (
          <span data-testid="icon:confirmed" {...stylex.props(styles.selectionMark)}>
            <BookingVisualAsset
              assetRole="selection-check"
              {...stylex.props(styles.confirmedCheck)}
            />
          </span>
        ) : null}
      </div>
    </m.div>
  )
}

function OrderSummary({
  journey,
  primary,
  locale,
  messages,
  onClose,
  onContinue,
  continueLabel = 'Choose time',
  quote,
  timeZone = 'UTC'
}: {
  readonly journey: BookingJourney
  readonly primary: PublicBookableService
  readonly locale: BookingLocale
  readonly messages: BookingSelectionMessages
  readonly onClose: () => void
  readonly onContinue?: () => void
  readonly continueLabel?: string
  readonly quote?: TimeSlotHold['quote']
  readonly timeZone?: string
}) {
  const quotedPrimary = quote?.services.find((service) => service.role === 'primary')
  const additions = quote
    ? quote.services.filter((service) => service.role !== 'primary')
    : journey.selection.additionalServiceIds
        .map((id) => journey.services.find((service) => service.id === id))
        .filter((service): service is PublicBookableService => service !== undefined)
  const displayedPrimary = quotedPrimary ?? primary
  const displayedProvider =
    quote?.assignedProvider.displayName ?? providerLabel(journey)
  const displayedTotal = quote?.totalMinor ?? total(journey)
  const displayedCurrency = quote?.currency ?? primary.currency
  const displayedAppointment = useMemo(() => {
    if (!quote) return null
    const instant = new Date(quote.startsAt)
    const date = new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      timeZone
    }).format(instant)
    const time = new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone
    }).format(instant)
    return `${date} ${messages.appointmentAt} ${time}`
  }, [locale, messages.appointmentAt, quote, timeZone])
  return (
    <m.div
      role="dialog"
      aria-modal="true"
      aria-label="Order summary"
      data-testid="cart:booking"
      data-cart-state="expanded"
      data-cart-mode={quote ? 'scheduleChosen' : undefined}
      tabIndex={-1}
      initial={{ y: '100%' }}
      animate={{ y: 0, height: 'calc(100% - 36px)' }}
      exit={{ y: '100%', transition: { duration: 0.15, ease: 'easeInOut' } }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
          return
        }
        if (event.key !== 'Tab') return
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        )
        if (controls.length === 0) return
        const first = controls[0]!
        const last = controls.at(-1)!
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }}
      {...stylex.props(styles.drawer)}
    >
      <div {...stylex.props(styles.drawerHeader)}>
        <div>
          <h2 {...stylex.props(styles.drawerTitle)}>Your order</h2>
          <p {...stylex.props(styles.drawerSubtitle)}>
            {journey.resolvedConfiguration.shopName.text}
          </p>
        </div>
        <button
          type="button"
          data-testid="btn:close"
          aria-label="Close order summary"
          onClick={onClose}
          {...stylex.props(
            styles.iconButton,
            styles.darkIconButton,
            styles.drawerClose
          )}
        >
          <svg
            aria-hidden="true"
            width="32"
            height="32"
            viewBox="0 0 32 32"
            fill="none"
          >
            <rect
              x="0.75"
              y="0.75"
              width="30.5"
              height="30.5"
              rx="15.25"
              {...stylex.props(styles.drawerCloseBorder)}
              strokeWidth="1.5"
            />
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M16.0015 17.4145L19.5884 21.0009L21.0028 19.5868L17.4158 16.0004L21.0025 12.4143L19.5882 11.0002L16.0015 14.5863L12.4146 11L11.0002 12.4141L14.5871 16.0004L11 19.587L12.4143 21.0011L16.0015 17.4145Z"
              {...stylex.props(styles.drawerCloseContent)}
            />
          </svg>
        </button>
      </div>
      <div {...stylex.props(styles.drawerBody)}>
        <div {...stylex.props(styles.orderCard)}>
          <div {...stylex.props(styles.rowBetween)}>
            <div>
              <p {...stylex.props(styles.orderProvider)}>{displayedProvider}</p>
              <p {...stylex.props(styles.orderMuted)}>{displayedPrimary.name}</p>
            </div>
            <strong {...stylex.props(styles.mono)}>
              {formatPrice(displayedPrimary.priceMinor, displayedPrimary.currency)}
            </strong>
          </div>
          {quote ? (
            <div {...stylex.props(styles.orderAppointment)}>
              <span data-testid="text:aptDate">{displayedAppointment}</span>
              <span>
                {quote.durationMinutes} {messages.durationMinutesShort}
              </span>
            </div>
          ) : null}
          {additions.map((service) => (
            <div key={service.id} {...stylex.props(styles.orderLine)}>
              <span>{service.name}</span>
              <span {...stylex.props(styles.mono)}>
                {formatPrice(service.priceMinor, service.currency)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div {...stylex.props(styles.drawerFooter)}>
        <div {...stylex.props(styles.subtotal)}>
          <span>Subtotal</span>
          <span {...stylex.props(styles.mono)}>
            {formatPrice(displayedTotal, displayedCurrency)}
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
          {continueLabel}
        </button>
      </div>
    </m.div>
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
