import { useEffect, useState, type FormEvent } from 'react'
import type { AvailabilityOffer } from '@b2b-saas-starter/capabilities/waiting-list'
import type { BookingLocale } from '../localization/booking-localization.ts'
import {
  BookingLanguagePicker,
  BookingLocalizationProvider,
  useBookingLocalization
} from '../localization/booking-localization-provider.tsx'
import {
  BookingButton,
  BookingField,
  BookingPageContent,
  BookingPageHeader,
  BookingStack,
  BookingStatus,
  BookingSurface,
  BookingText,
  BookingViewport
} from '../presentation/booking-primitives.tsx'

type State =
  | { kind: 'loading' }
  | { kind: 'offer'; offer: AvailabilityOffer }
  | { kind: 'accepted' }
  | { kind: 'applied'; applicationId: string }
  | { kind: 'declined' }
  | { kind: 'unavailable' }

export function WaitingListRouteFlow({
  pathname,
  application = false,
  applicationStatus = false,
  locale = 'en',
  embedding = 'standalone'
}: {
  pathname: string
  application?: boolean
  applicationStatus?: boolean
  locale?: BookingLocale
  embedding?: 'standalone' | 'widget' | 'google'
}) {
  return (
    <BookingLocalizationProvider sessionLocale={locale} onLocaleChange={() => {}}>
      <WaitingListRouteContent
        pathname={pathname}
        application={application}
        applicationStatus={applicationStatus}
        embedding={embedding}
      />
    </BookingLocalizationProvider>
  )
}

function WaitingListRouteContent({
  pathname,
  application,
  applicationStatus,
  embedding
}: {
  pathname: string
  application: boolean
  applicationStatus: boolean
  embedding: 'standalone' | 'widget' | 'google'
}) {
  const { message } = useBookingLocalization()
  const title = message('waiting.title')
  const offerTitle = message('waiting.offer_title')
  const intro = message('waiting.intro')
  const shop = message('waiting.shop')
  const service = message('waiting.service')
  const from = message('waiting.from')
  const until = message('waiting.until')
  const name = message('waiting.name')
  const email = message('waiting.email')
  const phone = message('waiting.phone')
  const checking = message('waiting.checking')
  const unavailable = message('waiting.unavailable')
  const withdraw = message('waiting.withdraw')
  const accept = message('waiting.accept')
  const decline = message('waiting.decline')
  const active = message('waiting.active')
  const withdrawn = message('waiting.withdrawn')
  const declined = message('waiting.declined')
  const held = message('waiting.held')
  const [state, setState] = useState<State>({
    kind: application ? 'unavailable' : 'loading'
  })
  useEffect(() => {
    if (application && !applicationStatus) return
    void fetch(pathname, {
      headers: { accept: 'application/json' },
      credentials: 'same-origin'
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('unavailable')
        const result = (await response.json()) as {
          state: string
          offer?: AvailabilityOffer
        }
        if (applicationStatus)
          setState(
            result.state === 'active'
              ? { kind: 'applied', applicationId: pathname.split('/').at(-1)! }
              : result.state === 'withdrawn'
                ? { kind: 'declined' }
                : { kind: 'unavailable' }
          )
        else if (result.offer) setState({ kind: 'offer', offer: result.offer })
      })
      .catch(() => setState({ kind: 'unavailable' }))
  }, [application, applicationStatus, pathname])
  const apply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const field = (name: string) => {
      const value = data.get(name)
      return typeof value === 'string' ? value : ''
    }
    const until = new Date(field('until')).toISOString()
    const response = await fetch(pathname, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shopId: field('shopId'),
        request: {
          serviceIds: [field('serviceId')],
          providerPreference: { kind: 'any' },
          from: new Date(field('from')).toISOString(),
          until
        },
        customer: {
          name: field('name'),
          email: field('email'),
          phone: field('phone') || undefined
        },
        expiresAt: until
      })
    })
    if (!response.ok) return setState({ kind: 'unavailable' })
    const result = (await response.json()) as { id: string }
    setState({ kind: 'applied', applicationId: result.id })
  }
  const respond = async (method: 'POST' | 'DELETE') => {
    const response = await fetch(pathname, { method, credentials: 'same-origin' })
    if (!response.ok) return setState({ kind: 'unavailable' })
    const result = (await response.json()) as { sessionUrl?: string }
    if (method === 'POST' && result.sessionUrl)
      return window.location.assign(result.sessionUrl)
    setState({ kind: method === 'POST' ? 'accepted' : 'declined' })
  }
  return (
    <BookingViewport embedding={embedding}>
      <BookingLanguagePicker label={message('label.language')} placement="toolbar" />
      <BookingPageHeader title={application ? title : offerTitle} />
      <BookingPageContent>
        <BookingStack>
          <BookingSurface>
            {application &&
            !applicationStatus &&
            state.kind !== 'applied' &&
            state.kind !== 'declined' ? (
              <form onSubmit={apply}>
                <BookingStack>
                  <BookingText>{intro}</BookingText>
                  <BookingField label={shop} name="shopId" required />
                  <BookingField label={service} name="serviceId" required />
                  <BookingField
                    label={from}
                    name="from"
                    type="datetime-local"
                    required
                  />
                  <BookingField
                    label={until}
                    name="until"
                    type="datetime-local"
                    required
                  />
                  <BookingField label={name} name="name" autoComplete="name" required />
                  <BookingField
                    label={email}
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                  />
                  <BookingField
                    label={phone}
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                  />
                  <BookingButton type="submit" tone="primary">
                    {title}
                  </BookingButton>
                </BookingStack>
              </form>
            ) : null}
            {!application && state.kind === 'loading' ? (
              <BookingStatus live>{checking}</BookingStatus>
            ) : null}
            {!application && state.kind === 'unavailable' ? (
              <BookingStatus tone="danger">{unavailable}</BookingStatus>
            ) : null}
            {state.kind === 'declined' ? (
              <p>{application ? withdrawn : declined}</p>
            ) : null}
            {state.kind === 'applied' ? (
              <div>
                <p>{active}</p>
                <BookingButton
                  type="button"
                  onClick={() =>
                    void fetch(
                      applicationStatus
                        ? pathname
                        : `${pathname}/${state.applicationId}`,
                      {
                        method: 'DELETE',
                        credentials: 'same-origin'
                      }
                    ).then((response) =>
                      setState(
                        response.ok ? { kind: 'declined' } : { kind: 'unavailable' }
                      )
                    )
                  }
                >
                  {withdraw}
                </BookingButton>
              </div>
            ) : null}
            {state.kind === 'accepted' ? <p>{application ? active : held}</p> : null}
            {!application && state.kind === 'offer' ? (
              <div>
                <p>{new Date(state.offer.slot.startsAt).toLocaleString()}</p>
                <BookingButton tone="primary" onClick={() => void respond('POST')}>
                  {accept}
                </BookingButton>
                <BookingButton onClick={() => void respond('DELETE')}>
                  {decline}
                </BookingButton>
              </div>
            ) : null}
          </BookingSurface>
        </BookingStack>
      </BookingPageContent>
    </BookingViewport>
  )
}
