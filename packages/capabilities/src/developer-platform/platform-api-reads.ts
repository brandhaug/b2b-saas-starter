import { Context, Effect, Layer, Schema } from 'effect'
import { eq } from 'drizzle-orm'
import {
  appointments,
  Database,
  merchants,
  providerServiceEligibility,
  providers,
  publicBookingPages,
  services
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'

const prefixedId = (prefix: string) =>
  Schema.String.check(Schema.isPattern(new RegExp(`^${prefix}_[A-Za-z0-9_-]+$`)))
const utcTimestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/)
)
const currencyCode = Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/))
const positiveMinutes = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))
const minorUnits = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
export const PlatformMoney = Schema.Struct({
  amountMinor: minorUnits,
  currency: currencyCode
})
export const PlatformMerchant = Schema.Struct({
  id: prefixedId('mer'),
  publicName: Schema.String,
  slug: Schema.String,
  timeZone: Schema.String,
  currency: currencyCode,
  publicPage: Schema.Struct({
    status: Schema.Literals(['published', 'unpublished']),
    bookingUrl: Schema.NullOr(Schema.String)
  }),
  createdAt: utcTimestamp,
  updatedAt: utcTimestamp
})
export const PlatformService = Schema.Struct({
  id: prefixedId('svc'),
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  category: Schema.NullOr(Schema.String),
  status: Schema.Literals(['active', 'inactive']),
  durationMinutes: positiveMinutes,
  price: PlatformMoney,
  providerIds: Schema.Array(prefixedId('prv')),
  createdAt: utcTimestamp,
  updatedAt: utcTimestamp
})
export const PlatformProvider = Schema.Struct({
  id: prefixedId('prv'),
  displayName: Schema.String,
  status: Schema.Literals(['active', 'inactive']),
  isDefault: Schema.Boolean,
  serviceIds: Schema.Array(prefixedId('svc')),
  createdAt: utcTimestamp,
  updatedAt: utcTimestamp
})
export const PlatformAppointment = Schema.Struct({
  id: prefixedId('apt'),
  status: Schema.Literals(['scheduled', 'completed', 'cancelled', 'no_show']),
  startsAt: utcTimestamp,
  endsAt: utcTimestamp,
  timeZone: Schema.String,
  providerPreference: Schema.Union([
    Schema.Struct({ kind: Schema.Literal('any') }),
    Schema.Struct({ kind: Schema.Literal('specific'), providerId: prefixedId('prv') })
  ]),
  provider: Schema.Struct({ id: prefixedId('prv'), displayName: Schema.String }),
  services: Schema.Array(
    Schema.Struct({
      id: prefixedId('svc'),
      role: Schema.Literals(['primary', 'additional']),
      name: Schema.String,
      durationMinutes: positiveMinutes,
      price: PlatformMoney
    })
  ),
  customer: Schema.Struct({
    name: Schema.String,
    email: Schema.String,
    phone: Schema.NullOr(Schema.String)
  }),
  checkoutPath: Schema.Literal('pay_in_person'),
  total: PlatformMoney,
  createdAt: utcTimestamp,
  updatedAt: utcTimestamp
})
export type PlatformMerchant = typeof PlatformMerchant.Type
export type PlatformService = typeof PlatformService.Type
export type PlatformProvider = typeof PlatformProvider.Type
export type PlatformAppointment = typeof PlatformAppointment.Type

export class PlatformReadInvalidCursor extends Schema.TaggedErrorClass<PlatformReadInvalidCursor>()(
  'PlatformReadInvalidCursor',
  {}
) {}
export class PlatformReadNotFound extends Schema.TaggedErrorClass<PlatformReadNotFound>()(
  'PlatformReadNotFound',
  {}
) {}

export type PlatformReadFilters = {
  readonly status?: readonly string[] | undefined
  readonly providerId?: readonly string[] | undefined
  readonly serviceId?: readonly string[] | undefined
  readonly startsAtFrom?: string | undefined
  readonly startsAtBefore?: string | undefined
  readonly updatedAtFrom?: string | undefined
}
export type PlatformReadPage<A> = {
  readonly data: readonly A[]
  readonly page: { readonly nextCursor: string | null }
}
type ListInput = PlatformReadFilters & {
  readonly cursor?: string | undefined
  readonly limit?: number | undefined
}
export type PlatformApiReadStore = {
  merchant: PlatformMerchant
  services: readonly PlatformService[]
  providers: readonly PlatformProvider[]
  appointments: readonly PlatformAppointment[]
}

const bytes = new TextEncoder()
const base64url = (value: Uint8Array | string) => {
  const raw = typeof value === 'string' ? value : String.fromCharCode(...value)
  return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
const sha256 = async (value: string) =>
  base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.encode(value))))
const sign = async (value: string, secret: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    bytes.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return base64url(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes.encode(value)))
  )
}
const normalizedFilters = (input: PlatformReadFilters) =>
  JSON.stringify({
    providerId: [...new Set(input.providerId ?? [])].sort(),
    serviceId: [...new Set(input.serviceId ?? [])].sort(),
    startsAtBefore: input.startsAtBefore ?? null,
    startsAtFrom: input.startsAtFrom ?? null,
    status: [...new Set(input.status ?? [])].sort(),
    updatedAtFrom: input.updatedAtFrom ?? null
  })

const encodeCursor = async (
  endpoint: string,
  filters: PlatformReadFilters,
  item: { id: string; updatedAt: string },
  secret: string
) => {
  const payload = base64url(
    JSON.stringify({
      e: endpoint,
      f: await sha256(normalizedFilters(filters)),
      p: [item.updatedAt, item.id],
      v: 1,
      x: Date.now() + 24 * 60 * 60_000
    })
  )
  return `${payload}.${await sign(payload, secret)}`
}
const decodeCursor = async (
  cursor: string,
  endpoint: string,
  filters: PlatformReadFilters,
  secret: string
) => {
  try {
    const [payload, signature, ...rest] = cursor.split('.')
    if (
      !payload ||
      !signature ||
      rest.length ||
      (await sign(payload, secret)) !== signature
    )
      return null
    const decoded = JSON.parse(
      atob(payload.replaceAll('-', '+').replaceAll('_', '/'))
    ) as {
      e: string
      f: string
      p: [string, string]
      v: number
      x: number
    }
    if (decoded.v !== 1 || decoded.e !== endpoint || decoded.x <= Date.now())
      return null
    if (decoded.f !== (await sha256(normalizedFilters(filters)))) return null
    return decoded.p
  } catch {
    return null
  }
}

const list = <A extends { id: string; updatedAt: string }>(
  endpoint: string,
  values: readonly A[],
  input: ListInput,
  matches: (value: A) => boolean,
  secret: string
): Effect.Effect<PlatformReadPage<A>, PlatformReadInvalidCursor> =>
  Effect.tryPromise({
    try: async () => {
      const limit = input.limit ?? 50
      const position = input.cursor
        ? await decodeCursor(input.cursor, endpoint, input, secret)
        : undefined
      if (input.cursor && !position) throw new PlatformReadInvalidCursor()
      const visible = values
        .filter(matches)
        .sort(
          (a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id)
        )
        .filter(
          (item) =>
            !position ||
            item.updatedAt > position[0] ||
            (item.updatedAt === position[0] && item.id > position[1])
        )
      const data = visible.slice(0, limit)
      return {
        data,
        page: {
          nextCursor:
            visible.length > limit
              ? await encodeCursor(endpoint, input, data.at(-1)!, secret)
              : null
        }
      }
    },
    catch: () => new PlatformReadInvalidCursor()
  })

export type PlatformApiReadsShape = {
  readonly merchant: (
    merchantId: string
  ) => Effect.Effect<PlatformMerchant, PlatformReadNotFound | CapabilityUnavailable>
  readonly services: (
    merchantId: string,
    input: ListInput
  ) => Effect.Effect<
    PlatformReadPage<PlatformService>,
    PlatformReadInvalidCursor | CapabilityUnavailable
  >
  readonly service: (
    merchantId: string,
    id: string
  ) => Effect.Effect<PlatformService, PlatformReadNotFound | CapabilityUnavailable>
  readonly providers: (
    merchantId: string,
    input: ListInput
  ) => Effect.Effect<
    PlatformReadPage<PlatformProvider>,
    PlatformReadInvalidCursor | CapabilityUnavailable
  >
  readonly provider: (
    merchantId: string,
    id: string
  ) => Effect.Effect<PlatformProvider, PlatformReadNotFound | CapabilityUnavailable>
  readonly appointments: (
    merchantId: string,
    input: ListInput
  ) => Effect.Effect<
    PlatformReadPage<PlatformAppointment>,
    PlatformReadInvalidCursor | CapabilityUnavailable
  >
  readonly appointment: (
    merchantId: string,
    id: string
  ) => Effect.Effect<PlatformAppointment, PlatformReadNotFound | CapabilityUnavailable>
}
export class PlatformApiReads extends Context.Service<
  PlatformApiReads,
  PlatformApiReadsShape
>()('@b2b-saas-starter/capabilities/PlatformApiReads') {}

const serviceFrom = (
  load: (
    merchantId: string
  ) => Effect.Effect<PlatformApiReadStore, CapabilityUnavailable>,
  secret: string
): PlatformApiReadsShape => ({
  merchant: (merchantId) =>
    Effect.flatMap(load(merchantId), (s) => Effect.succeed(s.merchant)),
  services: (merchantId, input) =>
    Effect.flatMap(load(merchantId), (s) =>
      list(
        'services',
        s.services,
        input,
        (v) =>
          (!input.status || input.status.includes(v.status)) &&
          (!input.providerId ||
            input.providerId.some((id) => v.providerIds.includes(id))) &&
          (!input.updatedAtFrom || v.updatedAt >= input.updatedAtFrom),
        secret
      )
    ),
  service: (merchantId, id) =>
    Effect.flatMap(load(merchantId), (s) =>
      s.services.find((v) => v.id === id)
        ? Effect.succeed(s.services.find((v) => v.id === id)!)
        : Effect.fail(new PlatformReadNotFound())
    ),
  providers: (merchantId, input) =>
    Effect.flatMap(load(merchantId), (s) =>
      list(
        'providers',
        s.providers,
        input,
        (v) =>
          (!input.status || input.status.includes(v.status)) &&
          (!input.serviceId ||
            input.serviceId.some((id) => v.serviceIds.includes(id))) &&
          (!input.updatedAtFrom || v.updatedAt >= input.updatedAtFrom),
        secret
      )
    ),
  provider: (merchantId, id) =>
    Effect.flatMap(load(merchantId), (s) =>
      s.providers.find((v) => v.id === id)
        ? Effect.succeed(s.providers.find((v) => v.id === id)!)
        : Effect.fail(new PlatformReadNotFound())
    ),
  appointments: (merchantId, input) =>
    Effect.flatMap(load(merchantId), (s) =>
      list(
        'appointments',
        s.appointments,
        input,
        (v) =>
          (!input.status || input.status.includes(v.status)) &&
          (!input.providerId || input.providerId.includes(v.provider.id)) &&
          (!input.startsAtFrom || v.startsAt >= input.startsAtFrom) &&
          (!input.startsAtBefore || v.startsAt < input.startsAtBefore) &&
          (!input.updatedAtFrom || v.updatedAt >= input.updatedAtFrom),
        secret
      )
    ),
  appointment: (merchantId, id) =>
    Effect.flatMap(load(merchantId), (s) =>
      s.appointments.find((v) => v.id === id)
        ? Effect.succeed(s.appointments.find((v) => v.id === id)!)
        : Effect.fail(new PlatformReadNotFound())
    )
})

export const SeedPlatformApiReads = (
  stores: ReadonlyMap<string, PlatformApiReadStore>,
  secret = 'seed-only-cursor-secret'
): Layer.Layer<PlatformApiReads> =>
  Layer.succeed(PlatformApiReads)(
    serviceFrom(
      (id) =>
        stores.has(id)
          ? Effect.succeed(stores.get(id)!)
          : Effect.fail(
              new CapabilityUnavailable({
                capability: 'platform-api-reads',
                reason: 'merchant_not_found'
              })
            ),
      secret
    )
  )

const appointmentDto = (
  row: typeof appointments.$inferSelect
): PlatformAppointment | null =>
  row.snapshot
    ? {
        id: row.id,
        status: row.status,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        timeZone: row.snapshot.merchantTimezone,
        providerPreference: row.snapshot.providerPreference,
        provider: row.snapshot.assignedProvider,
        services: row.snapshot.services.map((s) => ({
          id: s.id,
          role: s.role,
          name: s.name,
          durationMinutes: s.durationMinutes,
          price: { amountMinor: s.priceMinor, currency: s.currency }
        })),
        customer: row.snapshot.customerDetails,
        checkoutPath: row.snapshot.checkoutPath,
        total: {
          amountMinor: row.snapshot.totalMinor,
          currency: row.snapshot.currency
        },
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }
    : null

export const LivePlatformApiReads = (
  secret: string
): Layer.Layer<PlatformApiReads, never, Database> =>
  Layer.effect(
    PlatformApiReads,
    Effect.map(Database, (db) =>
      serviceFrom(
        (merchantId) =>
          orUnavailable('platform-api-reads')(
            Effect.gen(function* () {
              const merchant = (yield* db
                .select()
                .from(merchants)
                .where(eq(merchants.id, merchantId))
                .limit(1))[0]
              if (!merchant) return yield* Effect.fail(new Error('merchant_not_found'))
              const page = (yield* db
                .select()
                .from(publicBookingPages)
                .where(eq(publicBookingPages.merchantId, merchantId))
                .limit(1))[0]
              const serviceRows = yield* db
                .select()
                .from(services)
                .where(eq(services.merchantId, merchantId))
              const providerRows = yield* db
                .select()
                .from(providers)
                .where(eq(providers.merchantId, merchantId))
              const eligibility = yield* db
                .select()
                .from(providerServiceEligibility)
                .where(eq(providerServiceEligibility.merchantId, merchantId))
              const appointmentRows = yield* db
                .select()
                .from(appointments)
                .where(eq(appointments.merchantId, merchantId))
              return {
                merchant: {
                  id: merchant.id,
                  publicName: merchant.publicName,
                  slug: merchant.slug,
                  timeZone: merchant.timezone,
                  currency: merchant.currency,
                  publicPage: {
                    status: page?.status ?? 'unpublished',
                    bookingUrl:
                      page?.status === 'published' ? `/${merchant.slug}/booking` : null
                  },
                  createdAt: merchant.createdAt,
                  updatedAt: merchant.updatedAt
                },
                services: serviceRows.map((s) => ({
                  id: s.id,
                  name: s.name,
                  description: s.description,
                  category: s.category,
                  status: s.status,
                  durationMinutes: s.durationMinutes,
                  price: { amountMinor: s.priceMinor, currency: s.currency },
                  providerIds: eligibility
                    .filter((e) => e.serviceId === s.id)
                    .map((e) => e.providerId)
                    .sort(),
                  createdAt: s.createdAt,
                  updatedAt: s.updatedAt
                })),
                providers: providerRows.map((p) => ({
                  id: p.id,
                  displayName: p.displayName,
                  status: p.status,
                  isDefault: p.isDefault,
                  serviceIds: eligibility
                    .filter((e) => e.providerId === p.id)
                    .map((e) => e.serviceId)
                    .sort(),
                  createdAt: p.createdAt,
                  updatedAt: p.updatedAt
                })),
                appointments: appointmentRows
                  .map(appointmentDto)
                  .filter((a): a is PlatformAppointment => a !== null)
              }
            })
          ),
        secret
      )
    )
  )
