import { Data, Effect, Schema, type Scope } from 'effect'
import type { CapabilityUnavailable } from '@b2b-saas-starter/capabilities'
import { annotateWide } from '@b2b-saas-starter/logger'

export const json = (body: unknown, init?: ResponseInit): Response => {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(body, null, 2), { ...init, headers })
}

export const respond = <Success, Error, R>(
  effect: Effect.Effect<Success, Error, R>
): Effect.Effect<Response, Error, R | Scope.Scope> =>
  effect.pipe(
    Effect.flatMap((value) =>
      annotateWide({ outcome: 'ok' }).pipe(Effect.as(json(value)))
    )
  )

export const decodeJsonBody = (request: Request): Effect.Effect<unknown> =>
  Effect.promise(async () => {
    try {
      return (await request.json()) as unknown
    } catch {
      return null
    }
  })

/**
 * Rejected request body. `reason` doubles as the wide-event `outcome` and the
 * error body, so the pair can't drift per handler — `catchInvalidInput` maps
 * it to a 400 once, beside `catchCapabilityUnavailable`.
 */
export class InvalidInput extends Data.TaggedError('InvalidInput')<{
  readonly reason: string
}> {}

export const decodeBodyOr400 = <S extends Schema.ConstraintDecoder<unknown>>(
  request: Request,
  schema: S,
  reason: string
): Effect.Effect<S['Type'], InvalidInput> =>
  decodeJsonBody(request).pipe(
    Effect.flatMap((body) => {
      const decoded = Schema.decodeUnknownOption(schema)(body)
      return decoded._tag === 'None'
        ? Effect.fail(new InvalidInput({ reason }))
        : Effect.succeed(decoded.value)
    })
  )

export const catchInvalidInput = <R>(
  effect: Effect.Effect<Response, InvalidInput | CapabilityUnavailable, R | Scope.Scope>
): Effect.Effect<Response, CapabilityUnavailable, R | Scope.Scope> =>
  effect.pipe(
    Effect.catchTag('InvalidInput', (cause) =>
      annotateWide({ outcome: cause.reason }).pipe(
        Effect.as(json({ error: cause.reason }, { status: 400 }))
      )
    )
  )

// Uniform 503 seam: every Live-layer D1/queue outage surfaces as
// `CapabilityUnavailable` and must never escape as a defect or a 500.
export const catchCapabilityUnavailable = <R>(
  effect: Effect.Effect<Response, CapabilityUnavailable, R | Scope.Scope>
): Effect.Effect<Response, never, R | Scope.Scope> =>
  effect.pipe(
    Effect.catchTag('CapabilityUnavailable', (cause) =>
      annotateWide({
        outcome: 'capability_unavailable',
        capability: cause.capability,
        capabilityReason: cause.reason
      }).pipe(Effect.as(json({ error: 'capability_unavailable' }, { status: 503 })))
    )
  )
