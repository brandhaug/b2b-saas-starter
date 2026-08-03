import { useEffect, useState, type FormEvent } from 'react'
import type {
  WalkInOverview,
  WalkInQueueEntry
} from '@b2b-saas-starter/capabilities/walk-ins'
import {
  walkInCatalog,
  type BookingLocale
} from '../localization/booking-localization.ts'
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
  BookingSelectField,
  BookingStack,
  BookingStatus,
  BookingSurface,
  BookingViewport
} from '../presentation/booking-primitives.tsx'

const serviceRouteKey = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export function WalkInRouteFlow({
  pathname,
  locale,
  acknowledgment,
  initialServiceId,
  embedding = 'standalone'
}: {
  pathname: string
  locale: BookingLocale
  acknowledgment: boolean
  initialServiceId?: string | undefined
  embedding?: 'standalone' | 'widget' | 'google'
}) {
  return (
    <BookingLocalizationProvider sessionLocale={locale} onLocaleChange={() => {}}>
      <WalkInRouteContent
        pathname={pathname}
        acknowledgment={acknowledgment}
        initialServiceId={initialServiceId}
        embedding={embedding}
      />
    </BookingLocalizationProvider>
  )
}

function WalkInRouteContent({
  pathname,
  acknowledgment,
  initialServiceId,
  embedding
}: {
  pathname: string
  acknowledgment: boolean
  initialServiceId?: string | undefined
  embedding: 'standalone' | 'widget' | 'google'
}) {
  const { locale, message: bookingMessage } = useBookingLocalization()
  const message = walkInCatalog[locale]
  const [overview, setOverview] = useState<WalkInOverview | null>(null)
  const [current, setCurrent] = useState<WalkInQueueEntry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const matchingServices =
    overview?.services.filter(
      (service) =>
        service.id === initialServiceId ||
        serviceRouteKey(service.name) === initialServiceId
    ) ?? []
  const selectedServiceId = initialServiceId
    ? matchingServices.length === 1
      ? matchingServices[0]?.id
      : undefined
    : overview?.services[0]?.id
  useEffect(() => {
    let active = true
    const load = () =>
      void fetch(pathname, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin'
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('unavailable')
          const value = await response.json()
          if (!active) return
          if (acknowledgment) setCurrent(value as WalkInQueueEntry)
          else setOverview(value as WalkInOverview)
        })
        .catch(() => active && setError(message.unavailable))
    load()
    const timer = acknowledgment ? window.setInterval(load, 15_000) : undefined
    return () => {
      active = false
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [acknowledgment, message.unavailable, pathname])
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    const data = new FormData(event.currentTarget)
    const providerEntry = data.get('providerId')
    const providerId = typeof providerEntry === 'string' ? providerEntry : 'any'
    const response = await fetch(pathname, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        serviceId: data.get('serviceId'),
        providerPreference:
          providerId === 'any' ? { kind: 'any' } : { kind: 'specific', providerId },
        customerDetails: {
          name: data.get('name'),
          email: data.get('email'),
          phone: data.get('phone')
        },
        locale
      })
    })
    const result = (await response.json()) as { location?: string; error?: string }
    if (response.ok && result.location) window.location.assign(result.location)
    else {
      setError(
        result.error === 'walk_in_duplicate'
          ? message.duplicate
          : result.error === 'walk_ins_closed'
            ? message.closed
            : message.failed
      )
      setSubmitting(false)
    }
  }
  return (
    <BookingViewport embedding={embedding}>
      <BookingLanguagePicker
        label={bookingMessage('label.language')}
        placement="toolbar"
      />
      <BookingPageHeader title={acknowledgment ? message.statusTitle : message.title} />
      <BookingPageContent>
        <div data-walk-in-viewport>
          <BookingStack>
            <BookingSurface>
              {error ? <BookingStatus tone="danger">{error}</BookingStatus> : null}
              {acknowledgment ? (
                current ? (
                  <BookingStatus live>
                    <p>{message.status[current.status]}</p>
                    <p>
                      {message.position}: {current.position}
                    </p>
                    <p>
                      {message.wait}: {current.projectedWaitMinutes} {message.minutes}
                    </p>
                  </BookingStatus>
                ) : (
                  <BookingStatus live>{message.loading}</BookingStatus>
                )
              ) : overview ? (
                <>
                  {overview.state === 'closed' ? (
                    <p>{message.closed}</p>
                  ) : overview.services.length === 0 || !selectedServiceId ? (
                    <p>{message.unavailable}</p>
                  ) : (
                    <form onSubmit={submit}>
                      <BookingStack>
                        <BookingSelectField
                          label={message.service}
                          name="serviceId"
                          required
                          defaultValue={selectedServiceId}
                        >
                          {overview.services.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </BookingSelectField>
                        <BookingSelectField label={message.provider} name="providerId">
                          <option value="any">{message.any}</option>
                          {overview.providers.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </BookingSelectField>
                        <BookingField
                          label={message.name}
                          name="name"
                          autoComplete="name"
                          required
                        />
                        <BookingField
                          label={message.email}
                          name="email"
                          type="email"
                          autoComplete="email"
                          required
                        />
                        <BookingField
                          label={message.phone}
                          name="phone"
                          type="tel"
                          autoComplete="tel"
                          required
                        />
                        <BookingButton
                          disabled={submitting}
                          type="submit"
                          tone="primary"
                        >
                          {submitting ? message.joining : message.join}
                        </BookingButton>
                      </BookingStack>
                    </form>
                  )}
                  <p>
                    {overview.queue.length === 0
                      ? message.empty
                      : `${message.queue}: ${overview.queue.length}`}
                  </p>
                </>
              ) : (
                <p>{message.loading}</p>
              )}
            </BookingSurface>
          </BookingStack>
        </div>
      </BookingPageContent>
    </BookingViewport>
  )
}
