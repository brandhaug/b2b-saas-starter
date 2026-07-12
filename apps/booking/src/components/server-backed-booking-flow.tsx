import * as stylex from '@stylexjs/stylex'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Schema } from 'effect'
import { useEffect, useMemo, useState } from 'react'
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
import { BookingCheckoutFlow } from './booking-checkout-flow.tsx'
import { BookingSchedulingFlow } from './booking-scheduling-flow.tsx'
import { BookingSelectionFlow } from './booking-selection-flow.tsx'
import { BookingPartyFlow } from './booking-party-flow.tsx'
import { styles } from './booking-flow.styles.ts'
import { translateBookingMessage } from '../localization/booking-localization.ts'
import { useBookingLocalization } from '../localization/booking-localization-provider.tsx'
import {
  noOpCheckoutTelemetry,
  type CheckoutTelemetry
} from '../lib/checkout-telemetry.ts'

export function ServerBackedBookingFlow({
  merchantSlug,
  sessionId,
  telemetry = noOpCheckoutTelemetry,
  selectionRefreshedMessage = translateBookingMessage(
    'en',
    'feedback.selection_refreshed'
  )
}: {
  readonly merchantSlug: string
  readonly sessionId: string
  readonly telemetry?: CheckoutTelemetry
  readonly selectionRefreshedMessage?: string
}) {
  const { locale, message } = useBookingLocalization()
  const queryClient = useQueryClient()
  const [scheduling, setScheduling] = useState(false)
  const [slotLost, setSlotLost] = useState(false)
  const [holdExpired, setHoldExpired] = useState(false)
  const [checkout, setCheckout] = useState(false)
  const [review, setReview] = useState<CheckoutReview | null>(null)
  const [preparation, setPreparation] = useState<CheckoutPreparation | null>(null)
  const [validationIssues, setValidationIssues] = useState<
    readonly CustomerDetailsIssue[]
  >([])
  const [expiredSession, setExpiredSession] = useState(false)
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
    },
    onError: (error) => void telemetry.report(error)
  })
  const finalizeMutation = useMutation({
    mutationFn: async (input: {
      readonly acceptQuote: boolean
      readonly acceptPolicy: boolean
      readonly marketingConsents: readonly {
        readonly personId: string
        readonly channel: 'email'
        readonly granted: boolean
        readonly policyVersion: string
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
      if (!response.ok) throw new Error('confirmation unavailable')
      return (await response.json()) as { readonly location: string }
    },
    onSuccess: (result) => {
      if (result) window.location.assign(result.location)
    },
    onError: (error) => void telemetry.report(error)
  })
  const heldUntil = availability.data?.hold?.expiresAt
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
        title={message('selection.unavailable_title')}
        copy={message('selection.unavailable_copy')}
      />
    )
  if (!journey.data)
    return (
      <Status
        title={message('feedback.loading')}
        copy={message('scheduling.finding_copy')}
      />
    )
  if (scheduling) {
    if (expiredSession) {
      return (
        <Status
          title={message('status.session_expired')}
          copy={message('recovery.session_expired_copy')}
          href={`/${encodeURIComponent(merchantSlug)}/booking`}
          action={message('action.start_again')}
        />
      )
    }
    if (checkout) {
      return (
        <BookingCheckoutFlow
          review={review}
          preparation={preparation}
          busy={detailsMutation.isPending || finalizeMutation.isPending}
          validationIssues={validationIssues}
          validationMessages={{
            name_required: message('validation.name_required'),
            name_too_long: message('validation.name_too_long'),
            email_invalid: message('validation.email_invalid'),
            phone_invalid: message('validation.phone_invalid')
          }}
          copy={{
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
            privacy: message('checkout.privacy')
          }}
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
          title={message('status.times_unavailable')}
          copy={message('scheduling.unavailable_copy')}
        />
      )
    if (!availability.data)
      return (
        <Status
          title={message('scheduling.finding_title')}
          copy={message('scheduling.finding_copy')}
        />
      )
    return (
      <BookingSchedulingFlow
        availability={availability.data}
        busy={
          holdMutation.isPending ||
          releaseMutation.isPending ||
          groupHoldMutation.isPending
        }
        slotLost={slotLost}
        holdExpired={holdExpired}
        locale={locale}
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
      {party.data?.requests?.length ? (
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
        messages={{
          chooseProvider: message('selection.choose_provider'),
          chooseService: message('selection.choose_service'),
          shop: message('label.shop'),
          sourceLanguage: message('feedback.source_language'),
          anyProvider: message('selection.any_provider'),
          providerRestricted: message('selection.provider_restricted'),
          noServicesTitle: message('selection.no_services_title'),
          noServicesCopy: message('selection.no_services_copy'),
          inactiveEntitiesCopy: message('selection.inactive_entities_copy'),
          invalidAssociationsCopy: message('selection.invalid_associations_copy')
        }}
        busy={selectionMutation.isPending}
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
  action
}: {
  readonly title: string
  readonly copy: string
  readonly href?: string
  readonly action?: string
}) {
  return (
    <div {...stylex.props(styles.app)}>
      <div {...stylex.props(styles.widget)}>
        <main {...stylex.props(styles.main, styles.empty)}>
          <h1 {...stylex.props(styles.emptyTitle)}>{title}</h1>
          <p {...stylex.props(styles.emptyCopy)}>{copy}</p>
          {href && action ? <a href={href}>{action}</a> : null}
        </main>
      </div>
    </div>
  )
}
