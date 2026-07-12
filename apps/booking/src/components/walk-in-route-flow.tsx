import { useEffect, useState, type FormEvent } from 'react'
import type {
  WalkInOverview,
  WalkInQueueEntry
} from '@b2b-saas-starter/capabilities/walk-ins'
import type { BookingLocale } from '../localization/booking-localization.ts'
import {
  BookingStack,
  BookingSurface,
  BookingText,
  BookingViewport
} from '../presentation/booking-primitives.tsx'

const copy = {
  en: {
    title: 'Walk in today',
    statusTitle: 'Your walk-in status',
    closed: 'Walk-ins are closed right now.',
    empty: 'No one is waiting right now.',
    any: 'Any professional',
    service: 'Service',
    provider: 'Professional',
    name: 'Name',
    email: 'Email',
    phone: 'Phone',
    join: 'Join the queue',
    joining: 'Joining…',
    unavailable: 'Walk-ins are unavailable right now.',
    duplicate: 'You are already in this queue.',
    failed: 'We could not add you to the queue.',
    loading: 'Loading your private queue status…',
    position: 'Position',
    wait: 'Estimated wait',
    minutes: 'minutes',
    queue: 'People currently waiting',
    status: {
      waiting: 'Waiting',
      called: 'Called',
      serving: 'Serving',
      served: 'Served',
      removed: 'Removed',
      expired: 'Expired'
    }
  },
  es: {
    title: 'Atención sin cita',
    statusTitle: 'Tu estado en la cola',
    closed: 'La atención sin cita está cerrada ahora.',
    empty: 'No hay nadie esperando ahora.',
    any: 'Cualquier profesional',
    service: 'Servicio',
    provider: 'Profesional',
    name: 'Nombre',
    email: 'Correo',
    phone: 'Teléfono',
    join: 'Unirme a la cola',
    joining: 'Inscribiendo…',
    unavailable: 'La cola no está disponible ahora.',
    duplicate: 'Ya estás en esta cola.',
    failed: 'No pudimos añadirte a la cola.',
    loading: 'Cargando tu estado privado…',
    position: 'Posición',
    wait: 'Espera estimada',
    minutes: 'minutos',
    queue: 'Personas esperando',
    status: {
      waiting: 'En espera',
      called: 'Llamado',
      serving: 'En servicio',
      served: 'Atendido',
      removed: 'Retirado',
      expired: 'Caducado'
    }
  },
  fr: {
    title: 'Venir sans rendez-vous',
    statusTitle: 'Votre statut dans la file',
    closed: 'Les inscriptions sont fermées pour le moment.',
    empty: "Personne n'attend pour le moment.",
    any: "N'importe quel professionnel",
    service: 'Service',
    provider: 'Professionnel',
    name: 'Nom',
    email: 'E-mail',
    phone: 'Téléphone',
    join: 'Rejoindre la file',
    joining: 'Inscription…',
    unavailable: "La file n'est pas disponible.",
    duplicate: 'Vous êtes déjà dans cette file.',
    failed: 'Impossible de vous ajouter à la file.',
    loading: 'Chargement de votre statut privé…',
    position: 'Position',
    wait: 'Attente estimée',
    minutes: 'minutes',
    queue: 'Personnes en attente',
    status: {
      waiting: 'En attente',
      called: 'Appelé',
      serving: 'En service',
      served: 'Terminé',
      removed: 'Retiré',
      expired: 'Expiré'
    }
  },
  ro: {
    title: 'Programări fără rezervare',
    statusTitle: 'Starea ta în coadă',
    closed: 'Înscrierile sunt închise momentan.',
    empty: 'Nu așteaptă nimeni momentan.',
    any: 'Orice profesionist',
    service: 'Serviciu',
    provider: 'Profesionist',
    name: 'Nume',
    email: 'E-mail',
    phone: 'Telefon',
    join: 'Intră în coadă',
    joining: 'Înscriere…',
    unavailable: 'Înscrierile nu sunt disponibile momentan.',
    duplicate: 'Ești deja în această coadă.',
    failed: 'Nu te-am putut adăuga în coadă.',
    loading: 'Se încarcă starea privată…',
    position: 'Poziție',
    wait: 'Timp estimat',
    minutes: 'minute',
    queue: 'Persoane care așteaptă',
    status: {
      waiting: 'În așteptare',
      called: 'Chemat',
      serving: 'În desfășurare',
      served: 'Finalizat',
      removed: 'Eliminat',
      expired: 'Expirat'
    }
  }
} as const

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
  initialServiceId
}: {
  pathname: string
  locale: BookingLocale
  acknowledgment: boolean
  initialServiceId?: string | undefined
}) {
  const message = copy[locale]
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
    const providerId = String(data.get('providerId'))
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
    <BookingViewport>
      <div className="px-3 py-4 sm:px-8 sm:py-10" data-walk-in-viewport>
        <BookingStack>
          <BookingSurface>
            <BookingText variant="largeTitle">
              {acknowledgment ? message.statusTitle : message.title}
            </BookingText>
            {error ? <p role="alert">{error}</p> : null}
            {acknowledgment ? (
              current ? (
                <div aria-live="polite">
                  <p>{message.status[current.status]}</p>
                  <p>
                    {message.position}: {current.position}
                  </p>
                  <p>
                    {message.wait}: {current.projectedWaitMinutes} {message.minutes}
                  </p>
                </div>
              ) : (
                <p>{message.loading}</p>
              )
            ) : overview ? (
              <>
                {overview.state === 'closed' ? (
                  <p>{message.closed}</p>
                ) : overview.services.length === 0 || !selectedServiceId ? (
                  <p>{message.unavailable}</p>
                ) : (
                  <form onSubmit={submit}>
                    <label>
                      {message.service}
                      <select
                        name="serviceId"
                        required
                        defaultValue={selectedServiceId}
                      >
                        {overview.services.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {message.provider}
                      <select name="providerId">
                        <option value="any">{message.any}</option>
                        {overview.providers.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {message.name}
                      <input name="name" autoComplete="name" required />
                    </label>
                    <label>
                      {message.email}
                      <input name="email" type="email" autoComplete="email" required />
                    </label>
                    <label>
                      {message.phone}
                      <input name="phone" type="tel" autoComplete="tel" required />
                    </label>
                    <button disabled={submitting} type="submit">
                      {submitting ? message.joining : message.join}
                    </button>
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
    </BookingViewport>
  )
}
