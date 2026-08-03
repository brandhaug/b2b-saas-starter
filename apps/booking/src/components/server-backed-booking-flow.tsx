import * as stylex from '@stylexjs/stylex'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Schema } from 'effect'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import {
  BOOKING_AVAILABILITY_HORIZON_DAYS,
  BookingAvailability as BookingAvailabilitySchema,
  BookingJourney as BookingJourneySchema,
  BookingParty as BookingPartySchema,
  CheckoutReview as CheckoutReviewSchema,
  CheckoutPreparation as CheckoutPreparationSchema,
  PartyCheckoutReview as PartyCheckoutReviewSchema,
  BookingSchedulingRecovery as BookingSchedulingRecoverySchema,
  TimeSlotHold as TimeSlotHoldSchema,
  type BookingAvailability,
  type BookingSchedulingRecovery,
  type BookingJourney,
  type ProviderPreference,
  type ServiceSelection,
  type CheckoutReview,
  type CheckoutPreparation,
  type CustomerDetails,
  type CustomerDetailsIssue,
  bookingPartyContinuation,
  legacyBookingPolicySteps,
  pendingNotificationPolicyTargets
} from '@b2b-saas-starter/capabilities/booking'
import type {
  PaymentMethod,
  PaymentMethodEligibility,
  PaymentView
} from '@b2b-saas-starter/capabilities/payments'

import { BookingCheckoutFlow } from './booking-checkout-flow.tsx'
import { BookingSchedulingFlow } from './booking-scheduling-flow.tsx'
import { BookingSelectionFlow } from './booking-selection-flow.tsx'
import { BookingPartyFlow } from './booking-party-flow.tsx'
import {
  BookingLegacyCheckoutPopup,
  BookingLegacyNotificationPolicies,
  type LegacyCheckoutPhase
} from './booking-legacy-checkout-popup.tsx'
import { styles } from './booking-flow.styles.ts'
import { translateBookingMessage } from '../localization/booking-localization.ts'
import { useBookingLocalization } from '../localization/booking-localization-provider.tsx'
import {
  createBrowserCheckoutTelemetry,
  type CheckoutTelemetry
} from '../lib/checkout-telemetry.ts'
import {
  BookingLegacyProcessingOverlay,
  BookingWidgetShell
} from './booking-widget-shell.tsx'
import {
  BookingPremiumThemeBoundary,
  type BookingPremiumPalette
} from '../presentation/booking-premium-theme.tsx'
import type { CanonicalBookingRouteKind } from '../lib/booking-route-contract.ts'
import { buildCanonicalBookingPath } from '../lib/booking-route-contract.ts'
import {
  exchangeBookingConfirmationAccess,
  replaceWithBookingSuccess
} from '../lib/booking-processing-transition.ts'

type SettlementPaymentEligibility = PaymentMethodEligibility & {
  readonly giftCardMinor: number
  readonly externalPaymentMinor: number
}

type SelectionPage = 'locations' | 'services' | 'additional-services'

export const isFinalSlotConflictResponse = async (
  response: Response
): Promise<boolean> => {
  if (response.status !== 409) return false
  try {
    const body = (await response.json()) as { readonly kind?: unknown }
    return body.kind === 'conflict'
  } catch {
    return false
  }
}

const selectionPath = (
  merchantSlug: string,
  journey: BookingJourney,
  page: SelectionPage | 'schedule'
): string | null => {
  if (page === 'locations')
    return buildCanonicalBookingPath({ kind: 'shop-selection', merchantSlug })
  const shop = journey.shops.find((candidate) => candidate.id === journey.shopId)
  if (!shop) return null
  const preference = journey.providerPreference
  if (!preference) return null
  if (page === 'services')
    return buildCanonicalBookingPath({
      kind: 'service-selection',
      merchantSlug,
      shopSlug: shop.slug,
      providerSlug: preference.kind === 'specific' ? preference.providerId : 'any'
    })
  const serviceId = journey.selection.primaryServiceId
  if (!serviceId)
    return buildCanonicalBookingPath({
      kind: 'service-selection',
      merchantSlug,
      shopSlug: shop.slug,
      providerSlug: preference.kind === 'specific' ? preference.providerId : 'any'
    })
  return buildCanonicalBookingPath({
    kind: page === 'schedule' ? 'schedule' : 'additional-service-selection',
    merchantSlug,
    shopSlug: shop.slug,
    providerSlug: preference.kind === 'specific' ? preference.providerId : 'any',
    serviceSlug: serviceId
  })
}

const replaceBookingPath = (pathname: string | null) => {
  if (!pathname || typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.pathname = pathname
  window.history.replaceState(window.history.state, '', url)
}

export function ServerBackedBookingFlow({
  merchantSlug,
  sessionId,
  telemetry = createBrowserCheckoutTelemetry(),
  selectionRefreshedMessage = translateBookingMessage(
    'en',
    'feedback.selection_refreshed'
  ),
  initialRouteKind,
  onTitleActionMount,
  onSignIn
}: {
  readonly merchantSlug: string
  readonly sessionId: string
  readonly telemetry?: CheckoutTelemetry
  readonly selectionRefreshedMessage?: string
  readonly initialRouteKind?: CanonicalBookingRouteKind
  readonly onTitleActionMount?: (element: HTMLDivElement | null) => void
  readonly onSignIn?: () => void
}) {
  const { locale, message } = useBookingLocalization()
  const paymentReturn =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('payment_return') === '1'
  const paymentCancelled =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('payment_cancel') === '1'
  const queryClient = useQueryClient()
  const routeStartsScheduling =
    initialRouteKind === 'schedule' || initialRouteKind === 'checkout'
  const [scheduling, setScheduling] = useState(paymentReturn || routeStartsScheduling)
  const [slotLost, setSlotLost] = useState(false)
  const [holdExpired, setHoldExpired] = useState(false)
  const [checkout, setCheckout] = useState(
    paymentReturn || initialRouteKind === 'checkout'
  )
  const [legacyCheckoutPhase, setLegacyCheckoutPhase] =
    useState<LegacyCheckoutPhase>('policies')
  const legacyBookPending = useRef(false)
  const [notificationPoliciesOpen, setNotificationPoliciesOpen] = useState(false)
  const [review, setReview] = useState<CheckoutReview | null>(null)
  const [preparation, setPreparation] = useState<CheckoutPreparation | null>(null)
  const [validationIssues, setValidationIssues] = useState<
    readonly CustomerDetailsIssue[]
  >([])
  const [expiredSession, setExpiredSession] = useState(false)
  const [confirmationProcessing, setConfirmationProcessing] = useState(
    paymentReturn && !paymentCancelled
  )
  const [paymentEligibility, setPaymentEligibility] =
    useState<PaymentMethodEligibility>({ state: 'disabled', methods: [] })
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pay_in_person')
  const [paymentStatus, setPaymentStatus] = useState<
    'idle' | 'processing' | 'failed' | 'succeeded'
  >('idle')
  const [giftCardStatus, setGiftCardStatus] = useState<
    'idle' | 'applying' | 'applied' | 'failed'
  >('idle')
  const [giftCardMinor, setGiftCardMinor] = useState(0)
  const [externalPaymentMinor, setExternalPaymentMinor] = useState<number | null>(null)
  const paymentIdempotencyKey = useRef(`payment-${crypto.randomUUID()}`)
  const paymentReturnConfirmed = useRef(false)
  const [selectionRefreshed, setSelectionRefreshed] = useState(false)
  const [partyNow, setPartyNow] = useState('9999-12-31T23:59:59.999Z')
  useEffect(() => {
    const update = () => setPartyNow(new Date().toISOString())
    const timer = window.setInterval(update, 30_000)
    update()
    return () => window.clearInterval(timer)
  }, [])
  const base = `/${encodeURIComponent(merchantSlug)}/booking/session/${encodeURIComponent(sessionId)}`
  const checkoutPreparationKey = [
    'booking-checkout-preparation',
    merchantSlug,
    sessionId
  ] as const
  const recoverFinalSlotConflict = useCallback(async () => {
    await fetch(`${base}/hold`, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }
    }).catch((error) => void telemetry.report(error))
    setCheckout(false)
    setLegacyCheckoutPhase('policies')
    setNotificationPoliciesOpen(false)
    setPreparation(null)
    setReview(null)
    setHoldExpired(false)
    setSlotLost(true)
    queryClient.setQueryData<BookingAvailability>(
      ['booking-availability', merchantSlug, sessionId],
      (current) => (current ? { ...current, hold: null } : current)
    )
    queryClient.removeQueries({
      queryKey: ['booking-checkout-preparation', merchantSlug, sessionId]
    })
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['booking-availability', merchantSlug, sessionId]
      }),
      queryClient.invalidateQueries({
        queryKey: ['booking-party', merchantSlug, sessionId]
      })
    ])
  }, [base, merchantSlug, queryClient, sessionId, telemetry])
  const initialPreparation = useQuery({
    queryKey: checkoutPreparationKey,
    enabled: checkout,
    retry: false,
    queryFn: async () => {
      const response = await fetch(`${base}/checkout-prepare`, {
        credentials: 'same-origin'
      })
      if (!response.ok) throw new Error('checkout preparation unavailable')
      return Schema.decodeUnknownSync(CheckoutPreparationSchema)(await response.json())
    }
  })
  const preparationForCheckout = preparation ?? initialPreparation.data ?? null
  const queryKey = ['booking-selection', merchantSlug, sessionId] as const
  const journey = useQuery({
    queryKey,
    retry: false,
    queryFn: async () => {
      const response = await fetch(`${base}/selection`, {
        credentials: 'same-origin'
      })
      if (!response.ok) throw new Error('selection unavailable')
      return Schema.decodeUnknownSync(BookingJourneySchema)(await response.json())
    }
  })
  const partyKey = ['booking-party', merchantSlug, sessionId] as const
  const party = useQuery({
    queryKey: partyKey,
    enabled: Boolean(journey.data),
    retry: false,
    queryFn: async () => {
      const response = await fetch(`${base}/party`, { credentials: 'same-origin' })
      if (!response.ok) throw new Error('party unavailable')
      return Schema.decodeUnknownSync(BookingPartySchema)(await response.json())
    }
  })
  const returnedPayment = useQuery({
    queryKey: ['booking-payment-return', merchantSlug, sessionId],
    enabled: paymentReturn && Boolean(party.data),
    retry: false,
    refetchInterval: paymentCancelled ? false : 2_000,
    queryFn: async () => {
      const response = await fetch(`${base}/payment-status`, {
        credentials: 'same-origin'
      })
      if (!response.ok) throw new Error('payment status unavailable')
      return (await response.json()) as PaymentView | null
    }
  })
  useEffect(() => {
    const returned = returnedPayment.data
    if (!returned) return
    setPaymentMethod(returned.attempt.method)
    if (paymentCancelled) {
      setPaymentStatus('failed')
      setConfirmationProcessing(false)
      return
    }
    if (returned.payment.status !== 'captured' || paymentReturnConfirmed.current) {
      setPaymentStatus('processing')
      return
    }
    paymentReturnConfirmed.current = true
    setPaymentStatus('succeeded')
    void fetch(`${base}/confirm`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    })
      .then(async (response) => {
        if (await isFinalSlotConflictResponse(response)) {
          await recoverFinalSlotConflict()
          return null
        }
        if (!response.ok) throw new Error('confirmation unavailable')
        return (await response.json()) as { readonly location: string }
      })
      .then((result) => {
        if (result) window.location.assign(result.location)
      })
      .catch((error) => void telemetry.report(error))
  }, [
    base,
    paymentCancelled,
    recoverFinalSlotConflict,
    returnedPayment.data,
    telemetry
  ])
  const partyMutation = useMutation({
    mutationFn: async ({
      endpoint,
      body
    }: {
      readonly endpoint: 'add' | 'remove' | 'reorder' | 'activate'
      readonly body: Record<string, unknown>
      readonly preserveScheduling?: boolean
    }) => {
      const response = await fetch(`${base}/party-${endpoint}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!response.ok) throw new Error('party mutation rejected')
      return Schema.decodeUnknownSync(BookingPartySchema)(await response.json())
    },
    onSuccess: (value, mutation) => {
      queryClient.setQueryData(partyKey, value)
      if (mutation.endpoint === 'activate')
        void queryClient.invalidateQueries({ queryKey })
      if (mutation.endpoint === 'activate' && !mutation.preserveScheduling) {
        setScheduling(false)
        void queryClient.cancelQueries({ queryKey: availabilityKey })
        queryClient.removeQueries({ queryKey: availabilityKey })
      }
    }
  })
  const selectionMutation = useMutation({
    mutationFn: async (mutation: {
      readonly endpoint: 'shop' | 'services'
      readonly input: string | ServiceSelection
      readonly expectedVersion: number
    }) => {
      const response = await fetch(`${base}/${mutation.endpoint}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          version: mutation.expectedVersion,
          [mutation.endpoint === 'shop' ? 'shopId' : 'selection']: mutation.input
        })
      })
      if (response.status === 409) {
        const conflict = (await response.json()) as {
          readonly kind: 'version_conflict'
          readonly journey: BookingJourney
        }
        return { journey: conflict.journey, refreshed: true as const }
      }
      if (!response.ok) throw new Error('selection rejected')
      return {
        journey: Schema.decodeUnknownSync(BookingJourneySchema)(await response.json()),
        refreshed: false as const
      }
    },
    onSuccess: (value, mutation) => {
      queryClient.setQueryData(queryKey, value.journey)
      setSelectionRefreshed(value.refreshed)
      void queryClient.invalidateQueries({ queryKey: partyKey })
      const page =
        mutation.endpoint === 'shop'
          ? 'services'
          : value.journey.selection.primaryServiceId
            ? 'additional-services'
            : 'services'
      replaceBookingPath(selectionPath(merchantSlug, value.journey, page))
    }
  })
  const availabilityKey = useMemo(
    () => ['booking-availability', merchantSlug, sessionId] as const,
    [merchantSlug, sessionId]
  )
  const availability = useQuery({
    queryKey: availabilityKey,
    enabled: scheduling,
    queryFn: async () => {
      const response = await fetch(
        `${base}/availability?days=${BOOKING_AVAILABILITY_HORIZON_DAYS}`,
        { credentials: 'same-origin' }
      )
      if (!response.ok) throw new Error('availability unavailable')
      return Schema.decodeUnknownSync(BookingAvailabilitySchema)(await response.json())
    }
  })
  const holdMutation = useMutation({
    mutationFn: async (startsAt: string) => {
      const response = await fetch(`${base}/hold`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ startsAt })
      })
      if (response.status === 409) {
        const recovery: BookingSchedulingRecovery = Schema.decodeUnknownSync(
          BookingSchedulingRecoverySchema
        )(await response.json())
        if (recovery.kind === 'slot_lost') return null
      }
      if (!response.ok) throw new Error('hold unavailable')
      return Schema.decodeUnknownSync(TimeSlotHoldSchema)(await response.json())
    },
    onSuccess: (hold) => {
      if (!hold) {
        setHoldExpired(false)
        setSlotLost(true)
        void queryClient.invalidateQueries({ queryKey: availabilityKey })
        return
      }
      setHoldExpired(false)
      setSlotLost(false)
      queryClient.setQueryData<BookingAvailability>(availabilityKey, (current) =>
        current ? { ...current, hold } : current
      )
      void queryClient.invalidateQueries({ queryKey: partyKey })
    }
  })
  const releaseMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${base}/hold`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }
      })
      if (!response.ok) throw new Error('hold release unavailable')
    },
    onSuccess: () => {
      setCheckout(false)
      setHoldExpired(false)
      setSlotLost(false)
      queryClient.setQueryData<BookingAvailability>(availabilityKey, (current) =>
        current ? { ...current, hold: null } : current
      )
      void queryClient.invalidateQueries({ queryKey: availabilityKey })
      void queryClient.invalidateQueries({ queryKey: partyKey })
    }
  })
  const groupHoldMutation = useMutation({
    mutationFn: async () => {
      const requests = party.data?.requests ?? []
      if (requests.length <= 1) return
      if (requests.some((request) => !request.startsAt))
        throw new Error('party incomplete')
      const response = await fetch(`${base}/holds`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: partyNow,
          requests: requests.map((request) => ({
            bookingRequestId: request.id,
            startsAt: request.startsAt
          }))
        })
      })
      const body: unknown = await response.json()
      if (!response.ok) throw new Error('group holds unavailable')
      return Schema.decodeUnknownSync(Schema.Array(TimeSlotHoldSchema))(body)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: partyKey })
      setCheckout(true)
    }
  })
  const detailsMutation = useMutation({
    mutationFn: async (details: CustomerDetails) => {
      const response = await fetch(`${base}/customer-details`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(details)
      })
      if (response.status === 410) return { kind: 'session_expired' as const }
      if (response.status === 422) {
        const body = (await response.json()) as {
          readonly issues?: readonly CustomerDetailsIssue[]
        }
        return { kind: 'invalid' as const, issues: body.issues ?? [] }
      }
      if (response.status === 409) return { kind: 'expired' as const }
      if (!response.ok) throw new Error('checkout unavailable')
      return {
        kind: 'review' as const,
        review: Schema.decodeUnknownSync(CheckoutReviewSchema)(await response.json())
      }
    },
    onSuccess: async (result) => {
      if (result.kind === 'invalid') {
        legacyBookPending.current = false
        setValidationIssues(result.issues)
        return
      }
      if (result.kind === 'session_expired') {
        legacyBookPending.current = false
        setExpiredSession(true)
        return
      }
      if (result.kind === 'expired') {
        legacyBookPending.current = false
        setCheckout(false)
        setHoldExpired(true)
        setReview(null)
        void queryClient.invalidateQueries({ queryKey: availabilityKey })
        return
      }
      setValidationIssues([])
      void telemetry.track('customer_details_submitted')
      const currentParty = party.data
      const nextGuest = currentParty?.requests.find(
        (request) =>
          request.id !== currentParty.activeRequestId && !request.customerDetails
      )
      if (currentParty && nextGuest) {
        const activated = await fetch(`${base}/party-activate`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            version: currentParty.version,
            requestId: nextGuest.id
          })
        })
        if (activated.ok) {
          queryClient.setQueryData(
            partyKey,
            Schema.decodeUnknownSync(BookingPartySchema)(await activated.json())
          )
          setReview(null)
          return
        }
      }
      setReview(result.review)
      const prepared = await fetch(`${base}/checkout-prepare`, {
        credentials: 'same-origin'
      })
      if (!prepared.ok) throw new Error('checkout preparation unavailable')
      const nextPreparation = Schema.decodeUnknownSync(CheckoutPreparationSchema)(
        await prepared.json()
      )
      setPreparation(nextPreparation)
      const supportsPaymentRequest = 'PaymentRequest' in window
      const walletQuery = new URLSearchParams({
        applePay: 'ApplePaySession' in window ? '1' : '0',
        googlePay: supportsPaymentRequest ? '1' : '0',
        cashAppPay: supportsPaymentRequest ? '1' : '0'
      })
      const methods = await fetch(`${base}/payment-methods?${walletQuery}`, {
        credentials: 'same-origin'
      })
      if (methods.ok) {
        const {
          giftCardMinor: appliedMinor,
          externalPaymentMinor: remainingMinor,
          ...eligibility
        } = (await methods.json()) as SettlementPaymentEligibility
        setPaymentEligibility(eligibility)
        setGiftCardMinor(appliedMinor)
        setExternalPaymentMinor(remainingMinor)
        setPaymentMethod(
          remainingMinor > 0 && eligibility.methods[0]
            ? eligibility.methods[0]
            : 'pay_in_person'
        )
      }
      if (legacyBookPending.current && nextPreparation.quote) {
        legacyBookPending.current = false
        const consentTargets = pendingNotificationPolicyTargets({
          marketingPolicy: nextPreparation.marketingPolicy,
          requests: nextPreparation.party.requests,
          consents: nextPreparation.marketingConsents,
          operationalMessagingPermissions:
            nextPreparation.operationalMessagingPermissions ?? []
        })
        if (consentTargets.length > 0) setNotificationPoliciesOpen(true)
        else
          finalizeMutation.mutate({
            acceptQuote: !nextPreparation.quote.acceptedAt,
            acceptPolicy: Boolean(nextPreparation.policy),
            notificationPolicyDecisions: []
          })
      }
    },
    onError: (error) => {
      legacyBookPending.current = false
      void telemetry.report(error)
    }
  })
  const finalizeMutation = useMutation({
    mutationFn: async (input: {
      readonly acceptQuote: boolean
      readonly acceptPolicy: boolean
      readonly notificationPolicyDecisions: readonly {
        readonly bookingRequestId: string
        readonly channel: 'email' | 'sms'
        readonly granted: boolean
      }[]
    }) => {
      if (!preparationForCheckout?.quote) throw new Error('quote unavailable')
      if (input.acceptQuote) {
        const response = await fetch(`${base}/quote-accept`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ quoteId: preparationForCheckout.quote.id })
        })
        if (!response.ok) throw new Error('quote acceptance unavailable')
      }
      if (input.acceptPolicy && preparationForCheckout.policy) {
        const response = await fetch(`${base}/policy-accept`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ policyId: preparationForCheckout.policy.id })
        })
        if (!response.ok) throw new Error('policy acceptance unavailable')
        void telemetry.track('policy_accepted')
      }
      await Promise.all(
        input.notificationPolicyDecisions.map(async (decision) => {
          const operational = decision.channel === 'sms'
          const response = await fetch(
            `${base}/${operational ? 'operational-messaging-permission' : 'marketing-consent'}`,
            {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(
                operational
                  ? {
                      bookingRequestId: decision.bookingRequestId,
                      granted: decision.granted
                    }
                  : decision
              )
            }
          )
          if (!response.ok) throw new Error('notification permission unavailable')
        })
      )
      const reviewed = await fetch(`${base}/checkout-review`, {
        credentials: 'same-origin'
      })
      if (!reviewed.ok) throw new Error('party review unavailable')
      Schema.decodeUnknownSync(PartyCheckoutReviewSchema)(await reviewed.json())
      void telemetry.track('checkout_reviewed')
      if (paymentMethod !== 'pay_in_person') {
        setPaymentStatus('processing')
        const payment = await fetch(`${base}/payment-settle`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            method: paymentMethod,
            idempotencyKey: paymentIdempotencyKey.current,
            paymentMethodReference: 'hosted_checkout'
          })
        })
        if (!payment.ok) {
          setPaymentStatus('failed')
          throw new Error('payment settlement unavailable')
        }
        const settled = (await payment.json()) as {
          readonly view: PaymentView
          readonly nextActionUrl: string | null
        }
        if (settled.view.attempt.outcome === 'failed') {
          paymentIdempotencyKey.current = `payment-${crypto.randomUUID()}`
          setPaymentStatus('failed')
          return
        }
        if (settled.nextActionUrl) {
          window.location.assign(settled.nextActionUrl)
          return
        }
        if (settled.view.payment.status !== 'captured') {
          setPaymentStatus('processing')
          return
        }
        setPaymentStatus('succeeded')
      }
      const response = await fetch(`${base}/confirm`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      })
      if (response.status === 410) {
        setExpiredSession(true)
        return
      }
      if (response.status === 202) {
        setConfirmationProcessing(true)
        return
      }
      if (await isFinalSlotConflictResponse(response)) {
        await recoverFinalSlotConflict()
        return
      }
      if (!response.ok) throw new Error('confirmation unavailable')
      const result = (await response.json()) as { readonly location: string }
      const canonicalLocation = await exchangeBookingConfirmationAccess(result.location)
      if (!canonicalLocation) {
        window.location.assign(result.location)
        return
      }
      return { location: canonicalLocation }
    },
    onSuccess: (result) => {
      if (!result) return
      replaceWithBookingSuccess(result.location, message('feedback.success'))
    },
    onError: (error) => void telemetry.report(error)
  })
  const pendingConsentTargets = useMemo(
    () =>
      preparationForCheckout
        ? pendingNotificationPolicyTargets({
            marketingPolicy: preparationForCheckout.marketingPolicy,
            requests: preparationForCheckout.party.requests,
            consents: preparationForCheckout.marketingConsents,
            operationalMessagingPermissions:
              preparationForCheckout.operationalMessagingPermissions ?? []
          })
        : [],
    [preparationForCheckout]
  )
  const heldUntil = availability.data?.hold?.expiresAt
  const premiumPalette = journey.data?.resolvedConfiguration.premiumPalette ?? null
  useEffect(() => {
    if (!holdExpired || !party.data || partyMutation.isPending) return
    const continuation = bookingPartyContinuation(party.data, new Date().toISOString())
    if (continuation && party.data.activeRequestId !== continuation.requestId) {
      partyMutation.mutate({
        endpoint: 'activate',
        body: { version: party.data.version, requestId: continuation.requestId },
        preserveScheduling: true
      })
    }
  }, [holdExpired, party.data, partyMutation])
  useEffect(() => {
    if (!heldUntil) return
    const expire = () => {
      setHoldExpired(true)
      setSlotLost(false)
      queryClient.setQueryData<BookingAvailability>(availabilityKey, (current) =>
        current ? { ...current, hold: null } : current
      )
      void queryClient.invalidateQueries({ queryKey: availabilityKey })
    }
    const remaining = Date.parse(heldUntil) - Date.now()
    if (remaining <= 0) {
      expire()
      return
    }
    const timer = window.setTimeout(expire, remaining)
    return () => window.clearTimeout(timer)
  }, [availabilityKey, heldUntil, queryClient])

  if (journey.isError || selectionMutation.isError)
    return (
      <Status
        premiumPalette={premiumPalette}
        title={message('selection.unavailable_title')}
        copy={message('selection.unavailable_copy')}
      />
    )
  if (!journey.data)
    return (
      <Status
        premiumPalette={premiumPalette}
        title={message('feedback.loading')}
        copy={message('scheduling.finding_copy')}
      />
    )
  let schedulingContent: ReactNode = null
  let checkoutOverlay: ((target: HTMLElement | null) => ReactNode) | null = null
  let checkoutFormOpen = false
  const nextPartyRequest = party.data?.requests.find(
    (request) => request.id !== party.data.activeRequestId && !request.startsAt
  )
  const schedulingCheckoutLabel = nextPartyRequest
    ? message('action.continue')
    : message('action.checkout')
  const heldStartsAt = availability.data?.hold?.quote.startsAt ?? null
  const pendingStartsAt = holdMutation.isPending ? holdMutation.variables : null
  const pendingReplacement = Boolean(
    pendingStartsAt && pendingStartsAt !== heldStartsAt
  )
  const continueFromScheduling = () => {
    if (party.data && nextPartyRequest) {
      partyMutation.mutate({
        endpoint: 'activate',
        body: { version: party.data.version, requestId: nextPartyRequest.id }
      })
    } else if (party.data && party.data.requests.length > 1) groupHoldMutation.mutate()
    else {
      setCheckout(true)
      setLegacyCheckoutPhase('policies')
    }
  }
  const closeCheckout = () => {
    setCheckout(false)
    setLegacyCheckoutPhase('policies')
    legacyBookPending.current = false
    setNotificationPoliciesOpen(false)
    setPreparation(null)
    queryClient.removeQueries({ queryKey: checkoutPreparationKey })
  }
  if (scheduling) {
    if (expiredSession) {
      return (
        <Status
          premiumPalette={premiumPalette}
          title={message('status.session_expired')}
          copy={message('recovery.session_expired_copy')}
          href={`/${encodeURIComponent(merchantSlug)}/booking`}
          action={message('action.start_again')}
        />
      )
    }
    const checkoutFlow = (
      presentation: 'standalone' | 'withinBookingShell',
      popupTarget: HTMLElement | null = null
    ) =>
      confirmationProcessing ? (
        <Status
          premiumPalette={premiumPalette}
          title={message('confirmation.processing_title')}
          copy={message('confirmation.processing_copy')}
        />
      ) : (
        <BookingCheckoutFlow
          presentation={presentation}
          locale={locale}
          popupTarget={popupTarget}
          countryCode={
            availability.data?.timezone === 'Europe/Bucharest' ||
            availability.data?.hold?.quote.currency === 'RON'
              ? 'RO'
              : 'US'
          }
          shopName={journey.data.resolvedConfiguration.shopName.text}
          {...(() => {
            const selectedShop = journey.data.shops.find(
              (shop) => shop.id === journey.data.shopId
            )
            return {
              ...(selectedShop?.alias ? { shopAlias: selectedShop.alias } : {}),
              ...(selectedShop?.coverPhotoUrl
                ? { shopImageUrl: selectedShop.coverPhotoUrl }
                : {}),
              ...(selectedShop?.addressLines
                ? { shopAddressLines: selectedShop.addressLines }
                : {})
            }
          })()}
          {...(availability.data?.hold
            ? {
                draftSummary: {
                  services: availability.data.hold.quote.services,
                  totalMinor: availability.data.hold.quote.totalMinor,
                  currency: availability.data.hold.quote.currency
                }
              }
            : {})}
          premiumPalette={premiumPalette}
          review={review}
          preparation={preparationForCheckout}
          {...(onSignIn ? { onSignIn } : {})}
          busy={
            detailsMutation.isPending ||
            finalizeMutation.isPending ||
            giftCardStatus === 'applying'
          }
          validationIssues={validationIssues}
          validationMessages={{
            name_required: message('validation.name_required'),
            name_too_long: message('validation.name_too_long'),
            email_invalid: message('validation.email_invalid'),
            phone_invalid: message('validation.phone_invalid'),
            note_too_long: message('validation.note_too_long')
          }}
          copy={{
            processing: message('feedback.loading'),
            title: message('checkout.title'),
            haveAccount: message('checkout.have_account'),
            signIn: message('checkout.sign_in'),
            close: message('action.close'),
            guests: message('checkout.guests'),
            edit: message('checkout.edit'),
            emailOffers: (name) => `${message('checkout.email_offers')} ${name}`,
            operationalNotifications: message('checkout.operational_notifications'),
            acceptPolicy: (version) =>
              `${message('checkout.accept_policy')} ${version}`,
            priceProposal: (version) =>
              `${message('checkout.price_proposal')} ${version}`,
            payInPerson: message('status.pay_in_person'),
            book: message('checkout.book'),
            privacy: message('checkout.privacy'),
            privacyLink: message('checkout.privacy_link'),
            bookingAgreement: message('checkout.booking_agreement'),
            bookingAgreementConnector: message('checkout.booking_agreement_connector'),
            termsOfService: message('checkout.terms_of_service'),
            privacyPolicy: message('checkout.privacy_policy'),
            name: message('checkout.name'),
            yourInformation: message('checkout.your_information'),
            firstName: message('checkout.first_name'),
            lastName: message('checkout.last_name'),
            phoneNumber: message('checkout.phone_number'),
            chooseCountry: message('checkout.choose_country'),
            searchCountry: message('checkout.search_country'),
            clearSearch: message('checkout.clear_search'),
            yourRegion: message('checkout.your_region'),
            countryRegion: message('checkout.country_region'),
            firstNameRequired: message('checkout.first_name_required'),
            lastNameRequired: message('checkout.last_name_required'),
            emailInvalid: message('checkout.email_invalid'),
            phoneInvalid: message('checkout.phone_invalid'),
            email: message('checkout.email'),
            phoneOptional: message('checkout.phone_optional'),
            noteOptional: message('checkout.note_optional'),
            reviewBooking: message('checkout.review_booking'),
            total: message('checkout.total'),
            giftCard: message('checkout.gift_card'),
            giftCardCode: message('checkout.gift_card_id'),
            giftCardAmount: message('checkout.gift_card_amount'),
            applyGiftCard: message('checkout.apply_gift_card'),
            removeGiftCard: message('checkout.remove_gift_card'),
            giftCardApplied: message('checkout.gift_card_applied'),
            giftCardUnavailable: message('checkout.gift_card_unavailable')
          }}
          giftCard={{
            appliedMinor: giftCardMinor,
            status: giftCardStatus,
            onApply: (giftCardCode, amountMinor) => {
              setGiftCardStatus('applying')
              void (async () => {
                const response = await fetch(`${base}/gift-card-reserve`, {
                  method: 'POST',
                  credentials: 'same-origin',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    giftCardCode,
                    amountMinor,
                    idempotencyKey: `gift-card-${crypto.randomUUID()}`
                  })
                })
                if (!response.ok) throw new Error('gift card unavailable')
                const prepared = await fetch(`${base}/checkout-prepare`, {
                  credentials: 'same-origin'
                })
                if (!prepared.ok) throw new Error('checkout preparation unavailable')
                const nextPreparation = Schema.decodeUnknownSync(
                  CheckoutPreparationSchema
                )(await prepared.json())
                setPreparation(nextPreparation)
                const methods = await fetch(`${base}/payment-methods`, {
                  credentials: 'same-origin'
                })
                const settlementEligibility = methods.ok
                  ? ((await methods.json()) as SettlementPaymentEligibility)
                  : ({
                      state: 'disabled',
                      methods: [],
                      giftCardMinor: 0,
                      externalPaymentMinor: 0
                    } as const)
                const {
                  giftCardMinor: appliedMinor,
                  externalPaymentMinor: remainingMinor,
                  ...eligibility
                } = settlementEligibility
                setPaymentEligibility(eligibility)
                setGiftCardMinor(appliedMinor)
                setExternalPaymentMinor(remainingMinor)
                setPaymentMethod(
                  remainingMinor > 0 && eligibility.methods[0]
                    ? eligibility.methods[0]
                    : 'pay_in_person'
                )
                setGiftCardStatus('applied')
              })().catch(() => setGiftCardStatus('failed'))
            },
            onRemove: () => {
              setGiftCardStatus('applying')
              void fetch(`${base}/gift-card-release`, {
                method: 'DELETE',
                credentials: 'same-origin',
                headers: { 'idempotency-key': `gift-card-${crypto.randomUUID()}` }
              })
                .then(async (response) => {
                  if (!response.ok) throw new Error('gift card release unavailable')
                  const prepared = await fetch(`${base}/checkout-prepare`, {
                    credentials: 'same-origin'
                  })
                  if (!prepared.ok) throw new Error('checkout preparation unavailable')
                  setPreparation(
                    Schema.decodeUnknownSync(CheckoutPreparationSchema)(
                      await prepared.json()
                    )
                  )
                  setGiftCardMinor(0)
                  setExternalPaymentMinor(null)
                  setPaymentMethod('pay_in_person')
                  setGiftCardStatus('idle')
                })
                .catch(() => setGiftCardStatus('failed'))
            }
          }}
          payment={
            externalPaymentMinor === 0 && giftCardMinor > 0
              ? undefined
              : {
                  eligibility: paymentEligibility,
                  selected: paymentMethod,
                  status: paymentStatus,
                  allowPayInPerson: giftCardMinor === 0,
                  legend: message('payment.method'),
                  onSelect: (method) => {
                    setPaymentMethod(method)
                    setPaymentStatus('idle')
                  },
                  labels: {
                    pay_in_person: message('status.pay_in_person'),
                    card: message('payment.card'),
                    saved_card: message('payment.saved_card'),
                    apple_pay: message('payment.apple_pay'),
                    google_pay: message('payment.google_pay'),
                    cash_app_pay: message('payment.cash_app_pay'),
                    klarna: message('payment.klarna')
                  },
                  messages: {
                    disabled: message('payment.disabled'),
                    needs_configuration: message('payment.needs_configuration'),
                    processing: message('payment.processing'),
                    failed: message('payment.failed'),
                    succeeded: message('payment.succeeded')
                  }
                }
          }
          onSubmit={(details) => {
            if (presentation === 'withinBookingShell') legacyBookPending.current = true
            detailsMutation.mutate(details)
          }}
          onFinalize={(input) =>
            finalizeMutation.mutate({
              acceptQuote: input.acceptQuote,
              acceptPolicy: input.acceptPolicy,
              notificationPolicyDecisions: input.marketingConsents
            })
          }
          onEdit={(requestId) =>
            party.data &&
            partyMutation.mutate(
              {
                endpoint: 'activate',
                body: { version: party.data.version, requestId },
                preserveScheduling: true
              },
              {
                onSuccess: () => {
                  setReview(null)
                  setPreparation(null)
                }
              }
            )
          }
          {...(presentation === 'withinBookingShell' ? { onClose: closeCheckout } : {})}
        />
      )
    const applicableLegacyPolicyKinds = preparationForCheckout
      ? legacyBookingPolicySteps({
          adultsOnly: journey.data.resolvedConfiguration.adultsOnly,
          checkoutPolicyRequired: Boolean(preparationForCheckout.policy),
          ...preparationForCheckout.policyEligibility
        })
      : []
    if (checkout && (paymentReturn || initialRouteKind === 'checkout'))
      return checkoutFlow('standalone')
    const effectiveLegacyCheckoutPhase =
      applicableLegacyPolicyKinds.length === 0 ? 'userInfo' : legacyCheckoutPhase
    checkoutFormOpen =
      checkout &&
      Boolean(preparationForCheckout) &&
      effectiveLegacyCheckoutPhase === 'userInfo'
    checkoutOverlay = (target) => (
      <>
        <BookingLegacyCheckoutPopup
          open={checkout && Boolean(preparationForCheckout)}
          target={target}
          phase={effectiveLegacyCheckoutPhase}
          policyKinds={applicableLegacyPolicyKinds}
          appointmentCount={party.data?.requests.length ?? 1}
          onClose={closeCheckout}
          onPolicyComplete={() => setLegacyCheckoutPhase('userInfo')}
          cancellation={
            preparationForCheckout?.cancellationWindow && availability.data
              ? {
                  ...preparationForCheckout.cancellationWindow,
                  timeZone: availability.data.timezone,
                  locale
                }
              : null
          }
          copy={{
            cancellationPolicy: message('checkout.cancellation_policy'),
            cancellationPolicyCopy: message('checkout.cancellation_policy_copy'),
            cancellationPolicyCopyPlural: message(
              'checkout.cancellation_policy_copy_plural'
            ),
            noCancellation: message('checkout.no_cancellation'),
            noCancellationPlural: message('checkout.no_cancellation_plural'),
            now: message('checkout.now'),
            appointment: message('checkout.appointment'),
            appointments: message('checkout.appointments'),
            confirmBooking: message('checkout.title'),
            agree: message('checkout.agree'),
            close: message('action.close'),
            adultsTitle: message('checkout.adults_title'),
            adultsCopy: message('checkout.adults_copy'),
            adultsConfirm: message('checkout.adults_confirm'),
            policiesLabel: message('checkout.policies_label'),
            policyProgress: message('checkout.policy_progress')
          }}
        >
          {checkoutFlow('withinBookingShell', target)}
        </BookingLegacyCheckoutPopup>
        <BookingLegacyNotificationPolicies
          open={checkout && notificationPoliciesOpen}
          target={target}
          targets={pendingConsentTargets}
          shopName={journey.data.resolvedConfiguration.shopName.text}
          onClose={() => setNotificationPoliciesOpen(false)}
          onComplete={(notificationPolicyDecisions) => {
            setNotificationPoliciesOpen(false)
            if (!preparationForCheckout?.quote) return
            finalizeMutation.mutate({
              acceptQuote: !preparationForCheckout.quote.acceptedAt,
              acceptPolicy: Boolean(preparationForCheckout.policy),
              notificationPolicyDecisions
            })
          }}
          copy={{
            smsTitle: message('checkout.sms_consent_title'),
            emailTitle: message('checkout.email_consent_title'),
            smsCopy: message('checkout.sms_consent_copy'),
            emailCopy: message('checkout.email_consent_copy'),
            yes: message('checkout.consent_yes'),
            skip: message('checkout.consent_skip'),
            close: message('action.close'),
            notificationPreferences: message('checkout.notification_preferences'),
            policyProgress: message('checkout.policy_progress')
          }}
        />
        <BookingLegacyProcessingOverlay
          state={
            detailsMutation.isPending || finalizeMutation.isPending
              ? 'pending'
              : 'hidden'
          }
          pendingLabel={message('feedback.processing')}
          successLabel={message('feedback.success')}
        />
      </>
    )
    if (availability.isError || holdMutation.isError || groupHoldMutation.isError) {
      schedulingContent = (
        <SchedulingStatusContent
          title={message('status.times_unavailable')}
          copy={message('scheduling.unavailable_copy')}
        />
      )
    } else if (!availability.data) {
      schedulingContent = (
        <SchedulingStatusContent
          title={message('scheduling.finding_title')}
          copy={message('scheduling.finding_copy')}
        />
      )
    } else {
      schedulingContent = (
        <BookingSchedulingFlow
          embedded
          showOrderBar={false}
          premiumPalette={premiumPalette}
          availability={availability.data}
          busy={
            holdMutation.isPending ||
            releaseMutation.isPending ||
            groupHoldMutation.isPending
          }
          slotLost={slotLost}
          holdExpired={holdExpired}
          locale={locale}
          onBack={() => {
            setScheduling(false)
            replaceBookingPath(
              selectionPath(merchantSlug, journey.data, 'additional-services')
            )
          }}
          onSelect={(startsAt) => holdMutation.mutate(startsAt)}
          selectedStartsAt={pendingStartsAt ?? heldStartsAt}
          onRelease={() => releaseMutation.mutate()}
          {...(nextPartyRequest ? { checkoutLabel: schedulingCheckoutLabel } : {})}
          onCheckout={continueFromScheduling}
        />
      )
    }
  }
  return (
    <>
      {selectionRefreshed ? <output>{selectionRefreshedMessage}</output> : null}
      {!scheduling && party.data?.requests && party.data.requests.length > 1 ? (
        <BookingPartyFlow
          party={party.data}
          activeRequestId={party.data.activeRequestId ?? party.data.requests[0]!.id}
          busy={partyMutation.isPending}
          now={partyNow}
          messages={{
            title: message('party.title'),
            addGuest: message('party.add_guest'),
            removeGuest: message('party.remove_guest'),
            moveEarlier: message('party.move_earlier'),
            moveLater: message('party.move_later'),
            guest: (position) => `${message('party.guest')} ${position}`,
            incomplete: message('party.incomplete'),
            complete: message('party.complete')
          }}
          onAdd={() =>
            partyMutation.mutate({
              endpoint: 'add',
              body: { version: party.data.version }
            })
          }
          onRemove={(requestId) =>
            partyMutation.mutate({
              endpoint: 'remove',
              body: { version: party.data.version, requestId }
            })
          }
          onMove={(requestId, direction) => {
            const ids = [...party.data.requests]
              .sort((a, b) => a.position - b.position)
              .map((request) => request.id)
            const index = ids.indexOf(requestId)
            const target = direction === 'earlier' ? index - 1 : index + 1
            ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
            partyMutation.mutate({
              endpoint: 'reorder',
              body: { version: party.data.version, requestIds: ids }
            })
          }}
          onSwitch={(requestId) =>
            partyMutation.mutate({
              endpoint: 'activate',
              body: { version: party.data.version, requestId }
            })
          }
        />
      ) : null}
      <BookingSelectionFlow
        journey={journey.data}
        {...(initialRouteKind
          ? {
              initialPage:
                initialRouteKind === 'shop-selection'
                  ? ('locations' as const)
                  : ('services' as const)
            }
          : {})}
        locale={locale}
        messages={{
          chooseLocation: message('selection.choose_location'),
          chooseProvider: message('selection.choose_provider'),
          chooseService: message('selection.choose_service'),
          allCategories: message('selection.all_categories'),
          uncategorized: message('selection.uncategorized'),
          serviceCategory: message('selection.service_category'),
          chooseServiceFirst: message('selection.choose_service_first'),
          chooseTime: message('scheduling.choose_title'),
          shop: message('label.shop'),
          nearby: message('selection.nearby'),
          search: message('selection.search'),
          locating: message('selection.locating'),
          nearbySorted: message('selection.nearby_sorted'),
          nearbyUnavailable: message('selection.nearby_unavailable'),
          noLocationMatches: message('selection.no_location_matches'),
          sourceLanguage: message('feedback.source_language'),
          anyProvider: message('selection.any_provider'),
          providerAvailable: message('selection.provider_available'),
          providerNotAvailable: message('selection.provider_not_available'),
          providerRestricted: message('selection.provider_restricted'),
          appointmentAt: message('label.appointment_at'),
          durationMinutesShort: message('label.duration_minutes_short'),
          providerCards: {
            anyProvider: {
              titleLines: [
                message('selection.choose_service_first_line_1'),
                message('selection.choose_service_first_line_2')
              ],
              subtitleLines: [
                message('selection.any_provider_line_1'),
                message('selection.any_provider_line_2')
              ]
            },
            giftCard: {
              titleLines: [
                message('selection.gift_card_title_line_1'),
                message('selection.gift_card_title_line_2')
              ],
              subtitleLines: [
                message('selection.gift_card_subtitle_line_1'),
                message('selection.gift_card_subtitle_line_2')
              ]
            }
          },
          noServicesTitle: message('selection.no_services_title'),
          noServicesCopy: message('selection.no_services_copy'),
          inactiveEntitiesCopy: message('selection.inactive_entities_copy'),
          invalidAssociationsCopy: message('selection.invalid_associations_copy')
        }}
        busy={selectionMutation.isPending}
        {...(scheduling
          ? {
              continuation: {
                title: message('scheduling.choose_title'),
                content: schedulingContent,
                onBack: () => {
                  setScheduling(false)
                  replaceBookingPath(
                    selectionPath(merchantSlug, journey.data, 'additional-services')
                  )
                },
                ...(checkoutOverlay
                  ? {
                      overlay: checkoutOverlay,
                      cartFullscreen: checkoutFormOpen
                    }
                  : {}),
                ...(availability.data?.hold && !pendingReplacement
                  ? {
                      heldOrder: {
                        action: continueFromScheduling,
                        ctaLabel: schedulingCheckoutLabel,
                        continueLabel: message('action.continue'),
                        quote: availability.data.hold.quote,
                        timeZone: availability.data.timezone
                      }
                    }
                  : {}),
                ...(pendingReplacement
                  ? {
                      pendingCheckout: {
                        ctaLabel: schedulingCheckoutLabel
                      }
                    }
                  : {})
              }
            }
          : {})}
        {...(onTitleActionMount ? { onTitleActionMount } : {})}
        onNavigateBack={(page) =>
          replaceBookingPath(selectionPath(merchantSlug, journey.data, page))
        }
        onChooseShop={(shopId) =>
          selectionMutation.mutate({
            endpoint: 'shop',
            input: shopId,
            expectedVersion: journey.data.version
          })
        }
        onChooseServices={(selection) =>
          selectionMutation.mutate({
            endpoint: 'services',
            input: selection,
            expectedVersion: journey.data.version
          })
        }
        onContinue={() => {
          setScheduling(true)
          replaceBookingPath(selectionPath(merchantSlug, journey.data, 'schedule'))
        }}
      />
    </>
  )
}

function Status({
  title,
  copy,
  href,
  action,
  premiumPalette = null
}: {
  readonly title: string
  readonly copy: string
  readonly href?: string
  readonly action?: string
  readonly premiumPalette?: BookingPremiumPalette | null
}) {
  return (
    <BookingPremiumThemeBoundary palette={premiumPalette}>
      <BookingWidgetShell>
        <main {...stylex.props(styles.main, styles.empty)}>
          <h1 {...stylex.props(styles.emptyTitle)}>{title}</h1>
          <p {...stylex.props(styles.emptyCopy)}>{copy}</p>
          {href && action ? <a href={href}>{action}</a> : null}
        </main>
      </BookingWidgetShell>
    </BookingPremiumThemeBoundary>
  )
}

function SchedulingStatusContent({
  title,
  copy
}: {
  readonly title: string
  readonly copy: string
}) {
  return (
    <main
      data-testid="container:scrollable"
      {...stylex.props(styles.main, styles.embeddedSchedulingMain, styles.empty)}
    >
      <h1 {...stylex.props(styles.emptyTitle)}>{title}</h1>
      <p {...stylex.props(styles.emptyCopy)}>{copy}</p>
    </main>
  )
}
