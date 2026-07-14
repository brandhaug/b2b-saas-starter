import * as stylex from '@stylexjs/stylex'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Schema } from 'effect'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
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
  bookingPartyContinuation
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
import { styles } from './booking-flow.styles.ts'
import { translateBookingMessage } from '../localization/booking-localization.ts'
import { useBookingLocalization } from '../localization/booking-localization-provider.tsx'
import {
  createBrowserCheckoutTelemetry,
  type CheckoutTelemetry
} from '../lib/checkout-telemetry.ts'
import { BookingWidgetShell } from './booking-widget-shell.tsx'
import {
  BookingPremiumThemeBoundary,
  type BookingPremiumPalette
} from '../presentation/booking-premium-theme.tsx'

type SettlementPaymentEligibility = PaymentMethodEligibility & {
  readonly giftCardMinor: number
  readonly externalPaymentMinor: number
}

export function ServerBackedBookingFlow({
  merchantSlug,
  sessionId,
  telemetry = createBrowserCheckoutTelemetry(),
  selectionRefreshedMessage = translateBookingMessage(
    'en',
    'feedback.selection_refreshed'
  ),
  onTitleActionMount
}: {
  readonly merchantSlug: string
  readonly sessionId: string
  readonly telemetry?: CheckoutTelemetry
  readonly selectionRefreshedMessage?: string
  readonly onTitleActionMount?: (element: HTMLDivElement | null) => void
}) {
  const { locale, message } = useBookingLocalization()
  const paymentReturn =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('payment_return') === '1'
  const paymentCancelled =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('payment_cancel') === '1'
  const queryClient = useQueryClient()
  const [scheduling, setScheduling] = useState(paymentReturn)
  const [slotLost, setSlotLost] = useState(false)
  const [holdExpired, setHoldExpired] = useState(false)
  const [checkout, setCheckout] = useState(paymentReturn)
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
        if (!response.ok) throw new Error('confirmation unavailable')
        return (await response.json()) as { readonly location: string }
      })
      .then((result) => window.location.assign(result.location))
      .catch((error) => void telemetry.report(error))
  }, [base, paymentCancelled, returnedPayment.data, telemetry])
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
      readonly endpoint: 'shop' | 'provider' | 'services'
      readonly input: string | ProviderPreference | ServiceSelection
      readonly expectedVersion: number
    }) => {
      const response = await fetch(`${base}/${mutation.endpoint}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          version: mutation.expectedVersion,
          [mutation.endpoint === 'shop'
            ? 'shopId'
            : mutation.endpoint === 'provider'
              ? 'preference'
              : 'selection']: mutation.input
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
    onSuccess: (value) => {
      queryClient.setQueryData(queryKey, value.journey)
      setSelectionRefreshed(value.refreshed)
      void queryClient.invalidateQueries({ queryKey: partyKey })
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
      const response = await fetch(`${base}/availability`, {
        credentials: 'same-origin'
      })
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
        setValidationIssues(result.issues)
        return
      }
      if (result.kind === 'session_expired') {
        setExpiredSession(true)
        return
      }
      if (result.kind === 'expired') {
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
      setPreparation(
        Schema.decodeUnknownSync(CheckoutPreparationSchema)(await prepared.json())
      )
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
    },
    onError: (error) => void telemetry.report(error)
  })
  const finalizeMutation = useMutation({
    mutationFn: async (input: {
      readonly acceptQuote: boolean
      readonly acceptPolicy: boolean
      readonly marketingConsents: readonly {
        readonly bookingRequestId: string
        readonly channel: 'email'
        readonly granted: boolean
      }[]
    }) => {
      if (!preparation?.quote) throw new Error('quote unavailable')
      if (input.acceptQuote) {
        const response = await fetch(`${base}/quote-accept`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ quoteId: preparation.quote.id })
        })
        if (!response.ok) throw new Error('quote acceptance unavailable')
      }
      if (input.acceptPolicy && preparation.policy) {
        const response = await fetch(`${base}/policy-accept`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ policyId: preparation.policy.id })
        })
        if (!response.ok) throw new Error('policy acceptance unavailable')
        void telemetry.track('policy_accepted')
      }
      await Promise.all(
        input.marketingConsents.map(async (consent) => {
          const response = await fetch(`${base}/marketing-consent`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(consent)
          })
          if (!response.ok) throw new Error('marketing consent unavailable')
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
      if (!response.ok) throw new Error('confirmation unavailable')
      return (await response.json()) as { readonly location: string }
    },
    onSuccess: (result) => {
      if (result) window.location.assign(result.location)
    },
    onError: (error) => void telemetry.report(error)
  })
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
    if (checkout) {
      if (confirmationProcessing)
        return (
          <Status
            premiumPalette={premiumPalette}
            title={message('confirmation.processing_title')}
            copy={message('confirmation.processing_copy')}
          />
        )
      return (
        <BookingCheckoutFlow
          premiumPalette={premiumPalette}
          review={review}
          preparation={preparation}
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
            phone_invalid: message('validation.phone_invalid')
          }}
          copy={{
            processing: message('feedback.loading'),
            title: message('checkout.title'),
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
            name: message('checkout.name'),
            email: message('checkout.email'),
            phoneOptional: message('checkout.phone_optional'),
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
          onSubmit={(details) => detailsMutation.mutate(details)}
          onFinalize={(input) => finalizeMutation.mutate(input)}
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
        />
      )
    }
    if (availability.isError || holdMutation.isError || groupHoldMutation.isError)
      return (
        <Status
          premiumPalette={premiumPalette}
          title={message('status.times_unavailable')}
          copy={message('scheduling.unavailable_copy')}
        />
      )
    if (!availability.data)
      return (
        <Status
          premiumPalette={premiumPalette}
          title={message('scheduling.finding_title')}
          copy={message('scheduling.finding_copy')}
        />
      )
    return (
      <BookingSchedulingFlow
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
        onBack={() => setScheduling(false)}
        {...(onTitleActionMount ? { onTitleActionMount } : {})}
        onSelect={(startsAt) => holdMutation.mutate(startsAt)}
        onRelease={() => releaseMutation.mutate()}
        {...(party.data?.requests.some(
          (request) => request.id !== party.data.activeRequestId && !request.startsAt
        )
          ? { checkoutLabel: message('action.continue') }
          : {})}
        onCheckout={() => {
          const next = party.data?.requests.find(
            (request) => request.id !== party.data.activeRequestId && !request.startsAt
          )
          if (party.data && next) {
            partyMutation.mutate({
              endpoint: 'activate',
              body: { version: party.data.version, requestId: next.id }
            })
          } else if (party.data && party.data.requests.length > 1)
            groupHoldMutation.mutate()
          else setCheckout(true)
        }}
      />
    )
  }
  return (
    <>
      {selectionRefreshed ? <output>{selectionRefreshedMessage}</output> : null}
      {party.data?.requests && party.data.requests.length > 1 ? (
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
        locale={locale}
        messages={{
          chooseLocation: message('selection.choose_location'),
          chooseProvider: message('selection.choose_provider'),
          chooseService: message('selection.choose_service'),
          allCategories: message('selection.all_categories'),
          uncategorized: message('selection.uncategorized'),
          serviceCategory: message('selection.service_category'),
          chooseServiceFirst: message('selection.choose_service_first'),
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
        {...(onTitleActionMount ? { onTitleActionMount } : {})}
        onChooseShop={(shopId) =>
          selectionMutation.mutate({
            endpoint: 'shop',
            input: shopId,
            expectedVersion: journey.data.version
          })
        }
        onChooseProvider={(preference) =>
          selectionMutation.mutate({
            endpoint: 'provider',
            input: preference,
            expectedVersion: journey.data.version
          })
        }
        onChooseGiftCard={() => {
          const shop = journey.data.shops.find(
            (candidate) => candidate.id === journey.data.shopId
          )
          if (shop)
            window.location.assign(
              `/${encodeURIComponent(merchantSlug)}/booking/${encodeURIComponent(shop.slug)}/any/gift-cards`
            )
        }}
        onChooseServices={(selection) =>
          selectionMutation.mutate({
            endpoint: 'services',
            input: selection,
            expectedVersion: journey.data.version
          })
        }
        onContinue={() => setScheduling(true)}
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
