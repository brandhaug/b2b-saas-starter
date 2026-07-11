import { Context, Effect, Layer, Schema } from 'effect'
import { and, asc, desc, eq, gt, gte, inArray, lt, or } from 'drizzle-orm'
import {
  batch,
  batchQueries,
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
import type { FreshPasswordAuthenticationProof } from './platform-api-token-registry.ts'

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
export class PlatformWebhookDisabled extends Schema.TaggedErrorClass<PlatformWebhookDisabled>()(
  'PlatformWebhookDisabled',
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
type SeedDelivery = PlatformWebhookDeliveryAttempt & { readonly endpointId: string }
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
    | PlatformWebhookInvalidInput
    | PlatformWebhookNotFound
    | PlatformWebhookDisabled
    | CapabilityUnavailable
  >
  readonly disable: (input: {
    readonly merchantId: string
    readonly endpointId: string
    readonly actorUserId?: string
    readonly actorTokenId?: string
  }) => Effect.Effect<void, PlatformWebhookNotFound | CapabilityUnavailable>
  readonly rotateSecret: (input: {
    readonly merchantId: string
    readonly endpointId: string
    readonly actorUserId?: string
    readonly actorTokenId?: string
  }) => Effect.Effect<
    { readonly signingSecret: string },
    PlatformWebhookNotFound | PlatformWebhookDisabled | CapabilityUnavailable
  >
  readonly rotateSecretFromMerchantSettings: (input: {
    readonly merchantId: string
    readonly endpointId: string
    readonly proof: FreshPasswordAuthenticationProof
  }) => Effect.Effect<
    { readonly signingSecret: string },
    | PlatformWebhookInvalidInput
    | PlatformWebhookNotFound
    | PlatformWebhookDisabled
    | CapabilityUnavailable
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
const freshPasswordProof = (proof: FreshPasswordAuthenticationProof) => {
  const verifiedAt = Date.parse(proof.verifiedAt)
  return (
    proof.method === 'password' &&
    !Number.isNaN(verifiedAt) &&
    verifiedAt <= Date.now() &&
    Date.now() - verifiedAt <= 15 * 60_000
  )
}
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
const cursorBytes = new TextEncoder()
const base64url = (value: Uint8Array | string) => {
  const raw = typeof value === 'string' ? value : String.fromCharCode(...value)
  return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
const digest = async (value: string) =>
  base64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', cursorBytes.encode(value)))
  )
const sign = async (value: string, secret: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    cursorBytes.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return base64url(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, cursorBytes.encode(value)))
  )
}
const signaturesMatch = (left: string, right: string) => {
  const length = Math.max(left.length, right.length)
  let different = left.length ^ right.length
  for (let index = 0; index < length; index += 1)
    different |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  return different === 0
}
const cursorFilters = (input: ListInput | DeliveryListInput) =>
  JSON.stringify({
    attemptedAtFrom:
      'attemptedAtFrom' in input ? (input.attemptedAtFrom ?? null) : null,
    endpointId: 'endpointId' in input ? input.endpointId : null,
    eventIds: 'eventIds' in input ? [...new Set(input.eventIds ?? [])].sort() : [],
    statuses: [...new Set(input.statuses ?? [])].sort()
  })
const encodeCursor = async (
  endpoint: 'endpoints' | 'deliveries',
  input: ListInput | DeliveryListInput,
  parts: readonly [string, string],
  secret: string
) => {
  const payload = base64url(
    JSON.stringify({
      e: endpoint,
      f: await digest(cursorFilters(input)),
      p: parts,
      v: 1,
      x: Date.now() + 24 * 60 * 60_000
    })
  )
  return `${payload}.${await sign(payload, secret)}`
}
const parseCursor = async (
  value: string | undefined,
  endpoint: 'endpoints' | 'deliveries',
  input: ListInput | DeliveryListInput,
  secret: string
): Promise<readonly [string, string] | null | undefined> => {
  if (!value) return undefined
  try {
    const [payload, signature, ...rest] = value.split('.')
    if (
      !payload ||
      !signature ||
      rest.length ||
      !signaturesMatch(await sign(payload, secret), signature)
    )
      return null
    const parsed = JSON.parse(
      atob(payload.replaceAll('-', '+').replaceAll('_', '/'))
    ) as { e: string; f: string; p: [string, string]; v: number; x: number }
    if (
      parsed.e !== endpoint ||
      parsed.v !== 1 ||
      parsed.x <= Date.now() ||
      parsed.f !== (await digest(cursorFilters(input))) ||
      !Array.isArray(parsed.p) ||
      parsed.p.length !== 2 ||
      !parsed.p.every((part) => typeof part === 'string')
    )
      return null
    return parsed.p
  } catch {
    return null
  }
}

/* v8 ignore start -- Seed parity is exercised through the Platform API handler */
export const SeedPlatformWebhookEndpoints = (
  cursorSecret = 'seed-platform-webhook-cursor-secret',
  deliveries: readonly SeedDelivery[] = [],
  initialEndpoints: readonly (PlatformWebhookEndpoint & {
    readonly merchantId: string
    readonly signingSecret: string
  })[] = []
): Layer.Layer<PlatformWebhookEndpoints> => {
  let endpoints: Array<
    PlatformWebhookEndpoint & { merchantId: string; signingSecret: string }
  > = initialEndpoints.map((endpoint) => ({ ...endpoint }))
  const service: PlatformWebhookEndpointsShape = {
    list: (input) =>
      Effect.tryPromise({
        try: async () => {
          const position = await parseCursor(
            input.cursor,
            'endpoints',
            input,
            cursorSecret
          )
          if (input.cursor && !position) throw new PlatformWebhookInvalidCursor()
          const limit = input.limit ?? 50
          const visible = endpoints
            .filter(
              (e) =>
                e.merchantId === input.merchantId &&
                (!input.statuses || input.statuses.includes(e.status))
            )
            .sort(
              (a, b) =>
                a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id)
            )
            .filter(
              (e) =>
                !position ||
                e.updatedAt > position[0] ||
                (e.updatedAt === position[0] && e.id > position[1])
            )
          const data = visible.slice(0, limit)
          return {
            data: data.map(({ merchantId: _m, signingSecret: _s, ...e }) => e),
            page: {
              nextCursor:
                visible.length > limit
                  ? await encodeCursor(
                      'endpoints',
                      input,
                      [data.at(-1)!.updatedAt, data.at(-1)!.id],
                      cursorSecret
                    )
                  : null
            }
          }
        },
        catch: () => new PlatformWebhookInvalidCursor()
      }),
    create: (input) => {
      const invalid = validateConfig(input)
      if (invalid)
        return Effect.fail(new PlatformWebhookInvalidInput({ reason: invalid }))
      const now = new Date().toISOString(),
        signingSecret = secret()
      const endpoint = {
        id: newCapabilityId('wh'),
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
          return yield* Effect.fail(new PlatformWebhookDisabled())
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
      Effect.gen(function* () {
        const index = endpoints.findIndex(
          (e) => e.id === input.endpointId && e.merchantId === input.merchantId
        )
        if (index < 0) return yield* Effect.fail(new PlatformWebhookNotFound())
        const current = endpoints[index]!
        if (current.status === 'disabled') return
        const now = new Date().toISOString()
        endpoints[index] = {
          ...current,
          status: 'disabled',
          disabledAt: now,
          updatedAt: now
        }
      }),
    rotateSecret: (input) =>
      Effect.gen(function* () {
        const found = endpoints.find(
          (e) => e.id === input.endpointId && e.merchantId === input.merchantId
        )
        if (!found) return yield* Effect.fail(new PlatformWebhookNotFound())
        if (found.status === 'disabled')
          return yield* Effect.fail(new PlatformWebhookDisabled())
        const signingSecret = secret()
        found.signingSecret = signingSecret
        return { signingSecret }
      }),
    rotateSecretFromMerchantSettings: (input) => {
      if (!freshPasswordProof(input.proof))
        return Effect.fail(
          new PlatformWebhookInvalidInput({ reason: 'reauthentication_required' })
        )
      return service.rotateSecret({
        merchantId: input.merchantId,
        endpointId: input.endpointId,
        actorUserId: input.proof.userId
      })
    },
    deliveries: (input) =>
      Effect.tryPromise({
        try: async () => {
          if (
            !endpoints.some(
              (e) => e.id === input.endpointId && e.merchantId === input.merchantId
            )
          )
            throw new PlatformWebhookNotFound()
          const position = await parseCursor(
            input.cursor,
            'deliveries',
            input,
            cursorSecret
          )
          if (input.cursor && !position) throw new PlatformWebhookInvalidCursor()
          const limit = input.limit ?? 50
          const visible = deliveries
            .filter(
              (attempt) =>
                attempt.endpointId === input.endpointId &&
                (!input.statuses || input.statuses.includes(attempt.status)) &&
                (!input.eventIds || input.eventIds.includes(attempt.eventId)) &&
                (!input.attemptedAtFrom ||
                  attempt.attemptedAt >= input.attemptedAtFrom) &&
                (!position ||
                  attempt.attemptedAt < position[0] ||
                  (attempt.attemptedAt === position[0] && attempt.id < position[1]))
            )
            .sort(
              (a, b) =>
                b.attemptedAt.localeCompare(a.attemptedAt) || b.id.localeCompare(a.id)
            )
          const data = visible.slice(0, limit)
          return {
            data: data.map(({ endpointId: _endpointId, ...attempt }) => attempt),
            page: {
              nextCursor:
                visible.length > limit
                  ? await encodeCursor(
                      'deliveries',
                      input,
                      [data.at(-1)!.attemptedAt, data.at(-1)!.id],
                      cursorSecret
                    )
                  : null
            }
          }
        },
        catch: (failure) =>
          failure instanceof PlatformWebhookNotFound
            ? failure
            : new PlatformWebhookInvalidCursor()
      })
  }
  return Layer.succeed(PlatformWebhookEndpoints)(service)
}
/* v8 ignore stop */

const unavailable = orUnavailable('platform-webhook-endpoints')
export const LivePlatformWebhookEndpoints = (
  cursorSecret: string
): Layer.Layer<PlatformWebhookEndpoints, never, Database | AuditEventLog> => {
  return Layer.effect(PlatformWebhookEndpoints)(
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
      const auditInput = (
        eventType: string,
        merchantId: string,
        endpointId: string,
        actorUserId?: string,
        actorTokenId?: string
      ) => ({
        eventType,
        merchantId,
        targetType: 'webhook_endpoint',
        targetId: endpointId,
        actorUserId: actorUserId ?? null,
        metadata: actorTokenId ? { actorTokenId } : {}
      })
      const rotateSecret: PlatformWebhookEndpointsShape['rotateSecret'] = (input) =>
        Effect.gen(function* () {
          const current = yield* find(input.merchantId, input.endpointId)
          if (!current) return yield* Effect.fail(new PlatformWebhookNotFound())
          if (current.status === 'disabled')
            return yield* Effect.fail(new PlatformWebhookDisabled())
          const signingSecret = secret()
          const updatedAt = new Date().toISOString()
          const update = db
            .update(platformWebhookEndpoints)
            .set({ signingSecret, updatedAt })
            .where(
              and(
                eq(platformWebhookEndpoints.id, input.endpointId),
                eq(platformWebhookEndpoints.merchantId, input.merchantId),
                eq(platformWebhookEndpoints.status, 'active')
              )
            )
          const results = yield* unavailable(
            batchQueries(db, [
              update.toSQL(),
              audit.prepareRecordWhenPreviousChanged(
                auditInput(
                  'webhook_endpoint.secret_rotated',
                  input.merchantId,
                  input.endpointId,
                  input.actorUserId,
                  input.actorTokenId
                )
              )
            ])
          )
          if ((results[0]?.meta.changes ?? 0) === 0)
            return yield* Effect.fail(new PlatformWebhookDisabled())
          return { signingSecret }
        })
      return {
        list: (input) =>
          Effect.gen(function* () {
            const position = yield* Effect.promise(() =>
              parseCursor(input.cursor, 'endpoints', input, cursorSecret)
            )
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
                    ? yield* Effect.promise(() =>
                        encodeCursor(
                          'endpoints',
                          input,
                          [rows[limit - 1]!.updatedAt, rows[limit - 1]!.id],
                          cursorSecret
                        )
                      )
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
              id: newCapabilityId('wh'),
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
            yield* unavailable(
              batch(db, [
                db.insert(platformWebhookEndpoints).values(row),
                audit.prepareRecord(
                  auditInput(
                    'webhook_endpoint.created',
                    input.merchantId,
                    row.id,
                    input.actorUserId,
                    input.actorTokenId
                  )
                )
              ])
            )
            return { data: endpointDto(row), signingSecret }
          }),
        patch: (input) =>
          Effect.gen(function* () {
            const current = yield* find(input.merchantId, input.endpointId)
            if (!current) return yield* Effect.fail(new PlatformWebhookNotFound())
            if (current.status === 'disabled')
              return yield* Effect.fail(new PlatformWebhookDisabled())
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
            const update = db
              .update(platformWebhookEndpoints)
              .set(values)
              .where(
                and(
                  eq(platformWebhookEndpoints.id, input.endpointId),
                  eq(platformWebhookEndpoints.merchantId, input.merchantId),
                  eq(platformWebhookEndpoints.status, 'active')
                )
              )
            const results = yield* unavailable(
              batchQueries(db, [
                update.toSQL(),
                audit.prepareRecordWhenPreviousChanged(
                  auditInput(
                    'webhook_endpoint.updated',
                    input.merchantId,
                    input.endpointId,
                    input.actorUserId,
                    input.actorTokenId
                  )
                )
              ])
            )
            if ((results[0]?.meta.changes ?? 0) === 0)
              return yield* Effect.fail(new PlatformWebhookDisabled())
            return endpointDto({ ...current, ...values })
          }),
        disable: (input) =>
          Effect.gen(function* () {
            const current = yield* find(input.merchantId, input.endpointId)
            if (!current) return yield* Effect.fail(new PlatformWebhookNotFound())
            if (current.status === 'disabled') return
            const now = new Date().toISOString()
            const update = db
              .update(platformWebhookEndpoints)
              .set({ status: 'disabled', disabledAt: now, updatedAt: now })
              .where(
                and(
                  eq(platformWebhookEndpoints.id, input.endpointId),
                  eq(platformWebhookEndpoints.merchantId, input.merchantId),
                  eq(platformWebhookEndpoints.status, 'active')
                )
              )
            const results = yield* unavailable(
              batchQueries(db, [
                update.toSQL(),
                audit.prepareRecordWhenPreviousChanged(
                  auditInput(
                    'webhook_endpoint.disabled',
                    input.merchantId,
                    input.endpointId,
                    input.actorUserId,
                    input.actorTokenId
                  )
                )
              ])
            )
            if ((results[0]?.meta.changes ?? 0) === 0) return
          }),
        rotateSecret,
        rotateSecretFromMerchantSettings: (input) => {
          if (!freshPasswordProof(input.proof))
            return Effect.fail(
              new PlatformWebhookInvalidInput({ reason: 'reauthentication_required' })
            )
          return rotateSecret({
            merchantId: input.merchantId,
            endpointId: input.endpointId,
            actorUserId: input.proof.userId
          })
        },
        deliveries: (input) =>
          Effect.gen(function* () {
            if (!(yield* find(input.merchantId, input.endpointId)))
              return yield* Effect.fail(new PlatformWebhookNotFound())
            const position = yield* Effect.promise(() =>
              parseCursor(input.cursor, 'deliveries', input, cursorSecret)
            )
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
                    ? yield* Effect.promise(() =>
                        encodeCursor(
                          'deliveries',
                          input,
                          [rows[limit - 1]!.attemptedAt, rows[limit - 1]!.id],
                          cursorSecret
                        )
                      )
                    : null
              }
            }
          })
      }
    })
  )
}
