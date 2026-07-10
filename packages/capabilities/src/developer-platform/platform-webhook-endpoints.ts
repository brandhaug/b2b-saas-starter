/* v8 ignore file -- contract behavior is covered through the Platform API seam */
import { Context, Effect, Layer, Schema } from 'effect'
import { and, asc, desc, eq, gt, gte, inArray, lt, or } from 'drizzle-orm'
import {
  Database,
  platformWebhookDeliveries,
  platformWebhookEndpoints
} from '@b2b-saas-starter/db'
import type { CapabilityUnavailable } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { randomHex } from '../internal/crypto.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { validateWebhookUrl } from './webhook-url.ts'

export const APPOINTMENT_WEBHOOK_EVENTS = [
  'appointment.created',
  'appointment.updated',
  'appointment.cancelled',
  'appointment.completed',
  'appointment.no_show'
] as const
export const AppointmentWebhookEvent = Schema.Literals(APPOINTMENT_WEBHOOK_EVENTS)
export type AppointmentWebhookEvent = typeof AppointmentWebhookEvent.Type
export const PlatformWebhookEndpointStatus = Schema.Literals(['active', 'disabled'])
export type PlatformWebhookEndpointStatus = typeof PlatformWebhookEndpointStatus.Type

export const PlatformWebhookEndpoint = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  description: Schema.NullOr(Schema.String),
  status: PlatformWebhookEndpointStatus,
  eventTypes: Schema.Array(AppointmentWebhookEvent),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  disabledAt: Schema.NullOr(Schema.String)
})
export type PlatformWebhookEndpoint = typeof PlatformWebhookEndpoint.Type
export const PlatformWebhookDeliveryAttempt = Schema.Struct({
  id: Schema.String,
  eventId: Schema.String,
  eventType: AppointmentWebhookEvent,
  status: Schema.Literals([
    'delivered',
    'failed_retryable',
    'failed_permanent',
    'dead_lettered'
  ]),
  failureCode: Schema.NullOr(
    Schema.Literals([
      'network_error',
      'timeout',
      'http_status',
      'invalid_destination',
      'retries_exhausted'
    ])
  ),
  attemptNumber: Schema.Number,
  responseStatus: Schema.NullOr(Schema.Number),
  durationMs: Schema.Number,
  attemptedAt: Schema.String,
  nextAttemptAt: Schema.NullOr(Schema.String)
})
export type PlatformWebhookDeliveryAttempt = typeof PlatformWebhookDeliveryAttempt.Type

export class PlatformWebhookInvalidInput extends Schema.TaggedErrorClass<PlatformWebhookInvalidInput>()(
  'PlatformWebhookInvalidInput',
  { reason: Schema.String }
) {}
export class PlatformWebhookNotFound extends Schema.TaggedErrorClass<PlatformWebhookNotFound>()(
  'PlatformWebhookNotFound',
  {}
) {}
export class PlatformWebhookInvalidCursor extends Schema.TaggedErrorClass<PlatformWebhookInvalidCursor>()(
  'PlatformWebhookInvalidCursor',
  {}
) {}

type Page<A> = {
  readonly data: readonly A[]
  readonly page: { readonly nextCursor: string | null }
}
type EndpointInput = {
  readonly merchantId: string
  readonly url: string
  readonly description?: string | null
  readonly eventTypes: readonly AppointmentWebhookEvent[]
  readonly actorUserId?: string
  readonly actorTokenId?: string
}
type ListInput = {
  readonly merchantId: string
  readonly statuses?: readonly PlatformWebhookEndpointStatus[]
  readonly cursor?: string
  readonly limit?: number
}
type DeliveryListInput = {
  readonly merchantId: string
  readonly endpointId: string
  readonly statuses?: readonly PlatformWebhookDeliveryAttempt['status'][]
  readonly eventIds?: readonly string[]
  readonly attemptedAtFrom?: string
  readonly cursor?: string
  readonly limit?: number
}
export type PlatformWebhookEndpointsShape = {
  readonly list: (
    input: ListInput
  ) => Effect.Effect<
    Page<PlatformWebhookEndpoint>,
    PlatformWebhookInvalidCursor | CapabilityUnavailable
  >
  readonly create: (
    input: EndpointInput
  ) => Effect.Effect<
    { readonly data: PlatformWebhookEndpoint; readonly signingSecret: string },
    PlatformWebhookInvalidInput | CapabilityUnavailable
  >
  readonly patch: (
    input: Partial<Omit<EndpointInput, 'merchantId'>> & {
      readonly merchantId: string
      readonly endpointId: string
      readonly actorUserId?: string
      readonly actorTokenId?: string
    }
  ) => Effect.Effect<
    PlatformWebhookEndpoint,
    PlatformWebhookInvalidInput | PlatformWebhookNotFound | CapabilityUnavailable
  >
  readonly disable: (input: {
    readonly merchantId: string
    readonly endpointId: string
    readonly actorUserId?: string
    readonly actorTokenId?: string
  }) => Effect.Effect<void, CapabilityUnavailable>
  readonly rotateSecret: (input: {
    readonly merchantId: string
    readonly endpointId: string
    readonly actorUserId?: string
    readonly actorTokenId?: string
  }) => Effect.Effect<
    { readonly signingSecret: string },
    PlatformWebhookNotFound | CapabilityUnavailable
  >
  readonly deliveries: (
    input: DeliveryListInput
  ) => Effect.Effect<
    Page<PlatformWebhookDeliveryAttempt>,
    PlatformWebhookNotFound | PlatformWebhookInvalidCursor | CapabilityUnavailable
  >
}
export class PlatformWebhookEndpoints extends Context.Service<
  PlatformWebhookEndpoints,
  PlatformWebhookEndpointsShape
>()('@b2b-saas-starter/capabilities/PlatformWebhookEndpoints') {}

const secret = () => `whsec_${randomHex(24)}`
const normalizeDescription = (value?: string | null) => {
  const normalized = value?.trim() ?? ''
  return normalized === '' ? null : normalized
}
const validateConfig = (input: {
  url: string
  description?: string | null
  eventTypes: readonly string[]
}) => {
  const url = validateWebhookUrl(input.url)
  if (input.url.length > 2048) return 'url_too_long'
  if (!url.valid) return url.reason
  if ((normalizeDescription(input.description)?.length ?? 0) > 500)
    return 'description_too_long'
  const events = new Set(input.eventTypes)
  if (events.size < 1 || events.size > 5 || events.size !== input.eventTypes.length)
    return 'invalid_events'
  if (
    [...events].some(
      (event) => !(APPOINTMENT_WEBHOOK_EVENTS as readonly string[]).includes(event)
    )
  )
    return 'invalid_events'
  return null
}
const endpointDto = (
  row: typeof platformWebhookEndpoints.$inferSelect
): PlatformWebhookEndpoint => ({
  id: row.id,
  url: row.url,
  description: row.description,
  status: row.status,
  eventTypes: [...row.events] as AppointmentWebhookEvent[],
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  disabledAt: row.disabledAt
})
const deliveryDto = (
  row: typeof platformWebhookDeliveries.$inferSelect
): PlatformWebhookDeliveryAttempt => ({
  id: row.id,
  eventId: row.eventId,
  eventType: row.eventType as AppointmentWebhookEvent,
  status: row.status as PlatformWebhookDeliveryAttempt['status'],
  failureCode: row.failureCode as PlatformWebhookDeliveryAttempt['failureCode'],
  attemptNumber: row.attemptNumber,
  responseStatus: row.responseStatus,
  durationMs: row.durationMs,
  attemptedAt: row.attemptedAt,
  nextAttemptAt: row.nextAttemptAt
})
const cursor = (parts: readonly string[]) => btoa(JSON.stringify(parts))
const parseCursor = (value?: string): readonly [string, string] | null | undefined => {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(atob(value))
    return Array.isArray(parsed) &&
      parsed.length === 2 &&
      parsed.every((item) => typeof item === 'string')
      ? (parsed as [string, string])
      : null
  } catch {
    return null
  }
}

export const SeedPlatformWebhookEndpoints =
  (): Layer.Layer<PlatformWebhookEndpoints> => {
    let endpoints: Array<
      PlatformWebhookEndpoint & { merchantId: string; signingSecret: string }
    > = []
    const service: PlatformWebhookEndpointsShape = {
      list: (input) =>
        Effect.succeed({
          data: endpoints
            .filter(
              (e) =>
                e.merchantId === input.merchantId &&
                (!input.statuses || input.statuses.includes(e.status))
            )
            .map(({ merchantId: _m, signingSecret: _s, ...e }) => e),
          page: { nextCursor: null }
        }),
      create: (input) => {
        const invalid = validateConfig(input)
        if (invalid)
          return Effect.fail(new PlatformWebhookInvalidInput({ reason: invalid }))
        const now = new Date().toISOString(),
          signingSecret = secret()
        const endpoint = {
          id: newCapabilityId('whe'),
          merchantId: input.merchantId,
          url: input.url,
          description: normalizeDescription(input.description),
          status: 'active' as const,
          eventTypes: [...input.eventTypes],
          createdAt: now,
          updatedAt: now,
          disabledAt: null,
          signingSecret
        }
        endpoints.push(endpoint)
        const { merchantId: _m, signingSecret: _s, ...data } = endpoint
        return Effect.succeed({ data, signingSecret })
      },
      patch: (input) =>
        Effect.gen(function* () {
          const index = endpoints.findIndex(
            (e) => e.id === input.endpointId && e.merchantId === input.merchantId
          )
          if (index < 0) return yield* Effect.fail(new PlatformWebhookNotFound())
          const current = endpoints[index]!
          if (current.status === 'disabled')
            return yield* Effect.fail(new PlatformWebhookNotFound())
          if (
            input.url === undefined &&
            input.description === undefined &&
            input.eventTypes === undefined
          )
            return yield* Effect.fail(
              new PlatformWebhookInvalidInput({ reason: 'empty_patch' })
            )
          const next = {
            ...current,
            url: input.url ?? current.url,
            description:
              input.description === undefined
                ? current.description
                : normalizeDescription(input.description),
            eventTypes: input.eventTypes ? [...input.eventTypes] : current.eventTypes,
            updatedAt: new Date().toISOString()
          }
          const invalid = validateConfig(next)
          if (invalid)
            return yield* Effect.fail(
              new PlatformWebhookInvalidInput({ reason: invalid })
            )
          endpoints[index] = next
          const { merchantId: _m, signingSecret: _s, ...data } = next
          return data
        }),
      disable: (input) =>
        Effect.sync(() => {
          endpoints = endpoints.map((e) =>
            e.id === input.endpointId &&
            e.merchantId === input.merchantId &&
            e.status === 'active'
              ? {
                  ...e,
                  status: 'disabled',
                  disabledAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString()
                }
              : e
          )
        }),
      rotateSecret: (input) =>
        Effect.gen(function* () {
          const found = endpoints.find(
            (e) => e.id === input.endpointId && e.merchantId === input.merchantId
          )
          if (!found || found.status === 'disabled')
            return yield* Effect.fail(new PlatformWebhookNotFound())
          const signingSecret = secret()
          found.signingSecret = signingSecret
          return { signingSecret }
        }),
      deliveries: (input) =>
        endpoints.some(
          (e) => e.id === input.endpointId && e.merchantId === input.merchantId
        )
          ? Effect.succeed({ data: [], page: { nextCursor: null } })
          : Effect.fail(new PlatformWebhookNotFound())
    }
    return Layer.succeed(PlatformWebhookEndpoints)(service)
  }

const unavailable = orUnavailable('platform-webhook-endpoints')
export const LivePlatformWebhookEndpoints: Layer.Layer<
  PlatformWebhookEndpoints,
  never,
  Database | AuditEventLog
> = Layer.effect(PlatformWebhookEndpoints)(
  Effect.gen(function* () {
    const db = yield* Database
    const audit = yield* AuditEventLog
    const find = (merchantId: string, endpointId: string) =>
      unavailable(
        db
          .select()
          .from(platformWebhookEndpoints)
          .where(
            and(
              eq(platformWebhookEndpoints.merchantId, merchantId),
              eq(platformWebhookEndpoints.id, endpointId)
            )
          )
          .limit(1)
      ).pipe(Effect.map((rows) => rows[0]))
    const auditMutation = (
      eventType: string,
      endpointId: string,
      actorUserId?: string,
      actorTokenId?: string
    ) =>
      audit.record({
        eventType,
        targetType: 'webhook_endpoint',
        targetId: endpointId,
        actorUserId: actorUserId ?? null,
        metadata: actorTokenId ? { actorTokenId } : {}
      })
    return {
      list: (input) =>
        Effect.gen(function* () {
          const position = parseCursor(input.cursor)
          if (position === null)
            return yield* Effect.fail(new PlatformWebhookInvalidCursor())
          const filters = [
            eq(platformWebhookEndpoints.merchantId, input.merchantId),
            ...(input.statuses?.length
              ? [inArray(platformWebhookEndpoints.status, input.statuses)]
              : []),
            ...(position
              ? [
                  or(
                    gt(platformWebhookEndpoints.updatedAt, position[0]),
                    and(
                      eq(platformWebhookEndpoints.updatedAt, position[0]),
                      gt(platformWebhookEndpoints.id, position[1])
                    )
                  )!
                ]
              : [])
          ]
          const limit = input.limit ?? 50
          const rows = yield* unavailable(
            db
              .select()
              .from(platformWebhookEndpoints)
              .where(and(...filters))
              .orderBy(
                asc(platformWebhookEndpoints.updatedAt),
                asc(platformWebhookEndpoints.id)
              )
              .limit(limit + 1)
          )
          return {
            data: rows.slice(0, limit).map(endpointDto),
            page: {
              nextCursor:
                rows.length > limit
                  ? cursor([rows[limit - 1]!.updatedAt, rows[limit - 1]!.id])
                  : null
            }
          }
        }),
      create: (input) =>
        Effect.gen(function* () {
          const invalid = validateConfig(input)
          if (invalid)
            return yield* Effect.fail(
              new PlatformWebhookInvalidInput({ reason: invalid })
            )
          const now = new Date().toISOString(),
            signingSecret = secret()
          const row = {
            id: newCapabilityId('whe'),
            merchantId: input.merchantId,
            url: input.url,
            description: normalizeDescription(input.description),
            signingSecret,
            status: 'active' as const,
            events: [...input.eventTypes],
            createdAt: now,
            updatedAt: now,
            disabledAt: null
          }
          yield* unavailable(db.insert(platformWebhookEndpoints).values(row))
          yield* auditMutation(
            'webhook_endpoint.created',
            row.id,
            input.actorUserId,
            input.actorTokenId
          )
          return { data: endpointDto(row), signingSecret }
        }),
      patch: (input) =>
        Effect.gen(function* () {
          const current = yield* find(input.merchantId, input.endpointId)
          if (!current || current.status === 'disabled')
            return yield* Effect.fail(new PlatformWebhookNotFound())
          if (
            input.url === undefined &&
            input.description === undefined &&
            input.eventTypes === undefined
          )
            return yield* Effect.fail(
              new PlatformWebhookInvalidInput({ reason: 'empty_patch' })
            )
          const values = {
            url: input.url ?? current.url,
            description:
              input.description === undefined
                ? current.description
                : normalizeDescription(input.description),
            events: input.eventTypes ? [...input.eventTypes] : current.events,
            updatedAt: new Date().toISOString()
          }
          const invalid = validateConfig({
            url: values.url,
            description: values.description,
            eventTypes: values.events
          })
          if (invalid)
            return yield* Effect.fail(
              new PlatformWebhookInvalidInput({ reason: invalid })
            )
          yield* unavailable(
            db
              .update(platformWebhookEndpoints)
              .set(values)
              .where(
                and(
                  eq(platformWebhookEndpoints.id, input.endpointId),
                  eq(platformWebhookEndpoints.merchantId, input.merchantId),
                  eq(platformWebhookEndpoints.status, 'active')
                )
              )
          )
          yield* auditMutation(
            'webhook_endpoint.updated',
            input.endpointId,
            input.actorUserId,
            input.actorTokenId
          )
          return endpointDto({ ...current, ...values })
        }),
      disable: (input) =>
        Effect.gen(function* () {
          const current = yield* find(input.merchantId, input.endpointId)
          if (!current || current.status === 'disabled') return
          const now = new Date().toISOString()
          yield* unavailable(
            db
              .update(platformWebhookEndpoints)
              .set({ status: 'disabled', disabledAt: now, updatedAt: now })
              .where(
                and(
                  eq(platformWebhookEndpoints.id, input.endpointId),
                  eq(platformWebhookEndpoints.merchantId, input.merchantId),
                  eq(platformWebhookEndpoints.status, 'active')
                )
              )
          )
          yield* auditMutation(
            'webhook_endpoint.disabled',
            input.endpointId,
            input.actorUserId,
            input.actorTokenId
          )
        }),
      rotateSecret: (input) =>
        Effect.gen(function* () {
          const current = yield* find(input.merchantId, input.endpointId)
          if (!current || current.status === 'disabled')
            return yield* Effect.fail(new PlatformWebhookNotFound())
          const signingSecret = secret()
          yield* unavailable(
            db
              .update(platformWebhookEndpoints)
              .set({ signingSecret, updatedAt: new Date().toISOString() })
              .where(
                and(
                  eq(platformWebhookEndpoints.id, input.endpointId),
                  eq(platformWebhookEndpoints.merchantId, input.merchantId)
                )
              )
          )
          yield* auditMutation(
            'webhook_endpoint.secret_rotated',
            input.endpointId,
            input.actorUserId,
            input.actorTokenId
          )
          return { signingSecret }
        }),
      deliveries: (input) =>
        Effect.gen(function* () {
          if (!(yield* find(input.merchantId, input.endpointId)))
            return yield* Effect.fail(new PlatformWebhookNotFound())
          const position = parseCursor(input.cursor)
          if (position === null)
            return yield* Effect.fail(new PlatformWebhookInvalidCursor())
          const filters = [
            eq(platformWebhookDeliveries.endpointId, input.endpointId),
            ...(input.statuses?.length
              ? [inArray(platformWebhookDeliveries.status, input.statuses)]
              : []),
            ...(input.eventIds?.length
              ? [inArray(platformWebhookDeliveries.eventId, input.eventIds)]
              : []),
            ...(input.attemptedAtFrom
              ? [gte(platformWebhookDeliveries.attemptedAt, input.attemptedAtFrom)]
              : []),
            ...(position
              ? [
                  or(
                    lt(platformWebhookDeliveries.attemptedAt, position[0]),
                    and(
                      eq(platformWebhookDeliveries.attemptedAt, position[0]),
                      lt(platformWebhookDeliveries.id, position[1])
                    )
                  )!
                ]
              : [])
          ]
          const limit = input.limit ?? 50
          const rows = yield* unavailable(
            db
              .select()
              .from(platformWebhookDeliveries)
              .where(and(...filters))
              .orderBy(
                desc(platformWebhookDeliveries.attemptedAt),
                desc(platformWebhookDeliveries.id)
              )
              .limit(limit + 1)
          )
          return {
            data: rows.slice(0, limit).map(deliveryDto),
            page: {
              nextCursor:
                rows.length > limit
                  ? cursor([rows[limit - 1]!.attemptedAt, rows[limit - 1]!.id])
                  : null
            }
          }
        })
    }
  })
)
