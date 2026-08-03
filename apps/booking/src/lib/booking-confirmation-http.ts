import { Effect, FileSystem, Layer, Path } from 'effect'
import {
  Etag,
  HttpPlatform,
  HttpRouter,
  HttpServerResponse
} from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import {
  appointmentCalendarExport,
  type ConfirmationReadResult
} from '@b2b-saas-starter/capabilities/booking'
import { BookingConfirmationHttpApi } from './booking-confirmation-http-api.ts'
import {
  confirmationCookieName,
  readCookieValue
} from './confirmation-access-cookie.ts'

const CONFIRMATION_ID = /^[A-Za-z0-9_-]{1,128}$/
const APPOINTMENT_ID = /^[A-Za-z0-9_-]{1,128}$/
const CONFIRMATION_TOKEN = /^[a-f0-9]{64}$/
const HANDLED_HEADER = 'x-booking-confirmation-api'

export type BookingConfirmationHttpDependencies = {
  readonly read: (input: {
    readonly routeId: string
    readonly merchantSlug: string
    readonly credential: string
    readonly credentialKind: 'cookie'
    readonly now: string
  }) => Effect.Effect<ConfirmationReadResult, unknown>
  readonly takeRead: (key: string) => Effect.Effect<boolean, unknown>
  readonly now: () => string
}

const privateHeaders = {
  'cache-control': 'private, no-store',
  pragma: 'no-cache',
  'referrer-policy': 'no-referrer',
  [HANDLED_HEADER]: 'handled'
} as const

const text = (body: string, status: number) =>
  HttpServerResponse.text(body, { status, headers: privateHeaders })

const handlers = (dependencies: BookingConfirmationHttpDependencies) =>
  HttpApiBuilder.group(BookingConfirmationHttpApi, 'booking-confirmation', (group) =>
    group.handle('appointmentCalendarExport', ({ params, request }) => {
      if (
        !CONFIRMATION_ID.test(params.routeId) ||
        !APPOINTMENT_ID.test(params.appointmentId)
      )
        return Effect.succeed(text('Not found', 404))

      const clientKey =
        request.headers['cf-connecting-ip'] ??
        `path:${new URL(request.url, 'https://booking.invalid').pathname}`
      return dependencies.takeRead(`calendar:${clientKey}`).pipe(
        Effect.flatMap((allowed) => {
          if (!allowed) return Effect.succeed(text('Too many requests', 429))
          const credential = readCookieValue(
            request.headers.cookie,
            confirmationCookieName(params.routeId)
          )
          if (!credential || !CONFIRMATION_TOKEN.test(credential))
            return Effect.succeed(text('Not found', 404))
          const now = dependencies.now()
          return dependencies
            .read({
              routeId: params.routeId,
              merchantSlug: params.merchantSlug,
              credential,
              credentialKind: 'cookie',
              now
            })
            .pipe(
              Effect.flatMap((access) => {
                if (access.kind !== 'found')
                  return Effect.succeed(text('Not found', 404))
                return appointmentCalendarExport({
                  generatedAt: now,
                  appointmentId: params.appointmentId,
                  appointments: access.confirmation.appointments.map(
                    ({ id, status, startsAt, endsAt, snapshot }) => ({
                      id,
                      status,
                      startsAt,
                      endsAt,
                      snapshot: {
                        services: snapshot.services.map(({ name }) => ({ name }))
                      }
                    })
                  ),
                  shop: access.confirmation.shop
                }).pipe(
                  Effect.map((calendar) =>
                    HttpServerResponse.text(calendar, {
                      headers: {
                        ...privateHeaders,
                        'content-type': 'text/calendar; charset=utf-8',
                        'content-disposition': `attachment; filename="appointment-${params.appointmentId}.ics"`
                      }
                    })
                  ),
                  Effect.catch((error) =>
                    Effect.succeed(
                      error.reason === 'appointment_not_found'
                        ? text('Not found', 404)
                        : text('Temporarily unavailable', 503)
                    )
                  )
                )
              }),
              Effect.catch(() => Effect.succeed(text('Temporarily unavailable', 503)))
            )
        }),
        Effect.catch(() => Effect.succeed(text('Temporarily unavailable', 503)))
      )
    })
  )

const PlatformLive = Layer.mergeAll(
  Path.layer,
  Etag.layer,
  FileSystem.layerNoop({}),
  HttpPlatform.layer.pipe(Layer.provide(FileSystem.layerNoop({})))
)

export const handleBookingConfirmationHttpRequest = async (
  request: Request,
  dependencies: BookingConfirmationHttpDependencies
): Promise<Response | null> => {
  if (!new URL(request.url).pathname.endsWith('/calendar.ics')) return null
  const api = HttpApiBuilder.layer(BookingConfirmationHttpApi).pipe(
    Layer.provide(handlers(dependencies)),
    Layer.provide(PlatformLive)
  )
  const built = HttpRouter.toWebHandler(api, { disableLogger: true })
  try {
    const response = await built.handler(request)
    return response.headers.get(HANDLED_HEADER) === 'handled' ? response : null
  } finally {
    await built.dispose()
  }
}
