import { Context, Effect, Layer, Schema } from 'effect'
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import {
  Database,
  rawD1FromDatabase,
  type BatchStatement,
  type StoredAppointmentSnapshot
} from '@b2b-saas-starter/db'
import {
  CapabilityConflict,
  CapabilityDenied,
  CapabilityNotFound,
  CapabilityUnavailable
} from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { MerchantContext } from '../merchant-catalog/merchant-context.ts'
import { decodePersistedServiceBuffers } from '../merchant-catalog/service-buffers.ts'
import { prepareAppointmentCustomerAssociationBatch } from '../customer-directory/appointment-association.ts'

const NonEmpty = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1))
const IsoInstant = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/)
)
const PositiveMinor = Schema.Int.check(Schema.isGreaterThan(0))
const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const CustomerWire = Schema.Struct({
  name: NonEmpty,
  email: Schema.NullOr(Schema.String),
  phone: Schema.NullOr(Schema.String),
  note: Schema.optional(Schema.String)
})
const NotificationWire = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('notify') }),
  Schema.Struct({ kind: Schema.Literal('suppress'), reason: NonEmpty })
])
const CommonWire = {
  idempotencyKey: NonEmpty
} as const
const CollectionMethodWire = Schema.Literals([
  'cash',
  'card_terminal',
  'bank_transfer',
  'other'
])
const CancelWire = {
  ...CommonWire,
  expectedRevisions: Schema.Record(Schema.String, Revision),
  category: Schema.Literals([
    'customer_requested',
    'merchant_unavailable',
    'duplicate_or_error',
    'other'
  ]),
  privateNote: Schema.optional(Schema.String),
  customerMessage: Schema.optional(Schema.String),
  returnedAmounts: Schema.optional(Schema.Record(Schema.String, PositiveMinor)),
  notification: NotificationWire
} as const

export const MerchantAppointmentCommandSchema = Schema.Union([
  Schema.Struct({
    ...CommonWire,
    kind: Schema.Literals(['create', 'record_completed']),
    appointmentId: Schema.optional(NonEmpty),
    startsAt: IsoInstant,
    endsAt: IsoInstant,
    serviceIds: Schema.Array(NonEmpty).check(Schema.isMinLength(1)),
    customer: CustomerWire,
    customerRecordId: Schema.optional(NonEmpty),
    appointmentNote: Schema.optional(Schema.String),
    warningAcknowledged: Schema.optional(Schema.Boolean),
    overrideReason: Schema.optional(Schema.String),
    completionReason: Schema.optional(Schema.String),
    completionCollection: Schema.optional(
      Schema.Union([
        Schema.Struct({
          kind: Schema.Literal('collected'),
          amountMinor: PositiveMinor,
          method: CollectionMethodWire,
          recordedAt: IsoInstant,
          noteOrReference: Schema.optional(Schema.String)
        }),
        Schema.Struct({ kind: Schema.Literals(['already_recorded', 'collect_later']) })
      ])
    ),
    notification: NotificationWire
  }),
  Schema.Struct({
    ...CommonWire,
    kind: Schema.Literal('create_series'),
    seriesId: Schema.optional(NonEmpty),
    intervalWeeks: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 })),
    localStartTime: Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/)),
    occurrences: Schema.Array(
      Schema.Struct({
        appointmentId: Schema.optional(NonEmpty),
        startsAt: IsoInstant,
        endsAt: IsoInstant
      })
    ).check(Schema.isMinLength(2), Schema.isMaxLength(52)),
    serviceIds: Schema.Array(NonEmpty).check(Schema.isMinLength(1)),
    customer: CustomerWire,
    customerRecordId: Schema.optional(NonEmpty),
    warningAcknowledged: Schema.optional(Schema.Boolean),
    overrideReason: Schema.optional(Schema.String),
    notification: NotificationWire
  }),
  Schema.Struct({
    ...CommonWire,
    kind: Schema.Literal('edit'),
    appointmentId: NonEmpty,
    expectedRevision: Revision,
    customer: CustomerWire,
    appointmentNote: Schema.optional(Schema.String),
    notification: Schema.optional(NotificationWire)
  }),
  Schema.Struct({
    ...CommonWire,
    kind: Schema.Literal('reschedule'),
    appointmentId: NonEmpty,
    expectedRevision: Revision,
    startsAt: IsoInstant,
    endsAt: IsoInstant,
    serviceIds: Schema.optional(Schema.Array(NonEmpty).check(Schema.isMinLength(1))),
    warningAcknowledged: Schema.optional(Schema.Boolean),
    overrideReason: Schema.optional(Schema.String),
    notification: NotificationWire
  }),
  Schema.Struct({
    ...CancelWire,
    kind: Schema.Literal('cancel'),
    appointmentId: NonEmpty
  }),
  Schema.Struct({
    ...CancelWire,
    kind: Schema.Literal('cancel_party'),
    bookingPartyId: NonEmpty
  }),
  Schema.Struct({
    ...CancelWire,
    kind: Schema.Literal('cancel_remaining_series'),
    seriesId: NonEmpty
  }),
  Schema.Struct({
    ...CommonWire,
    kind: Schema.Literals(['complete', 'no_show', 'correct_outcome']),
    appointmentId: NonEmpty,
    expectedRevision: Revision,
    outcome: Schema.optional(Schema.Literals(['completed', 'no_show'])),
    reason: Schema.optional(Schema.String),
    completionChoice: Schema.optional(
      Schema.Literals(['already_recorded', 'collect_later'])
    ),
    collection: Schema.optional(
      Schema.Struct({
        amountMinor: PositiveMinor,
        method: CollectionMethodWire,
        recordedAt: IsoInstant,
        noteOrReference: Schema.optional(Schema.String)
      })
    )
  }),
  Schema.Struct({
    ...CommonWire,
    kind: Schema.Literal('append_collection'),
    appointmentId: NonEmpty,
    expectedRevision: Revision,
    entry: Schema.Struct({
      kind: Schema.Literals(['collection', 'return']),
      amountMinor: PositiveMinor,
      method: CollectionMethodWire,
      recordedAt: IsoInstant,
      noteOrReference: Schema.optional(Schema.String),
      offsetsEntryId: Schema.optional(NonEmpty),
      correctionReason: Schema.optional(Schema.String)
    })
  })
])

export type AppointmentNotificationChoice =
  | { readonly kind: 'notify' }
  | { readonly kind: 'suppress'; readonly reason: string }

export type MerchantAppointmentCustomer = {
  readonly name: string
  readonly email: string | null
  readonly phone: string | null
  readonly note?: string | undefined
}

type CommandBase = {
  readonly idempotencyKey: string
}

export type CreateMerchantAppointment = CommandBase & {
  readonly kind: 'create' | 'record_completed'
  readonly appointmentId?: string | undefined
  readonly startsAt: string
  readonly endsAt: string
  readonly serviceIds: readonly string[]
  readonly customer: MerchantAppointmentCustomer
  readonly customerRecordId?: string | undefined
  readonly appointmentNote?: string | undefined
  readonly warningAcknowledged?: boolean | undefined
  readonly overrideReason?: string | undefined
  readonly completionReason?: string | undefined
  readonly completionCollection?:
    | {
        readonly kind: 'collected'
        readonly amountMinor: number
        readonly method: ExternalCollectionMethod
        readonly recordedAt: string
        readonly noteOrReference?: string | undefined
      }
    | { readonly kind: 'already_recorded' | 'collect_later' }
    | undefined
  readonly notification?: AppointmentNotificationChoice | undefined
}

export type CreateMerchantAppointmentSeries = CommandBase & {
  readonly kind: 'create_series'
  readonly seriesId?: string | undefined
  readonly intervalWeeks: number
  readonly localStartTime: string
  readonly occurrences: readonly {
    readonly appointmentId?: string | undefined
    readonly startsAt: string
    readonly endsAt: string
  }[]
  readonly serviceIds: readonly string[]
  readonly customer: MerchantAppointmentCustomer
  readonly customerRecordId?: string | undefined
  readonly warningAcknowledged?: boolean | undefined
  readonly overrideReason?: string | undefined
  readonly notification: AppointmentNotificationChoice
}

export type EditMerchantAppointment = CommandBase & {
  readonly kind: 'edit'
  readonly appointmentId: string
  readonly expectedRevision: number
  readonly customer: MerchantAppointmentCustomer
  readonly appointmentNote?: string | undefined
  readonly notification?: AppointmentNotificationChoice | undefined
}

export type RescheduleMerchantAppointment = CommandBase & {
  readonly kind: 'reschedule'
  readonly appointmentId: string
  readonly expectedRevision: number
  readonly startsAt: string
  readonly endsAt: string
  readonly serviceIds?: readonly string[] | undefined
  readonly warningAcknowledged?: boolean | undefined
  readonly overrideReason?: string | undefined
  readonly notification: AppointmentNotificationChoice
}

export type CancelMerchantAppointments = CommandBase & {
  readonly kind: 'cancel' | 'cancel_party' | 'cancel_remaining_series'
  readonly appointmentId?: string | undefined
  readonly bookingPartyId?: string | undefined
  readonly seriesId?: string | undefined
  readonly expectedRevisions: Readonly<Record<string, number>>
  readonly category:
    | 'customer_requested'
    | 'merchant_unavailable'
    | 'duplicate_or_error'
    | 'other'
  readonly privateNote?: string | undefined
  readonly customerMessage?: string | undefined
  readonly returnedAmounts?: Readonly<Record<string, number>> | undefined
  readonly notification: AppointmentNotificationChoice
}

export type SetMerchantAppointmentOutcome = CommandBase & {
  readonly kind: 'complete' | 'no_show' | 'correct_outcome'
  readonly appointmentId: string
  readonly expectedRevision: number
  readonly outcome?: 'completed' | 'no_show' | undefined
  readonly reason?: string | undefined
  readonly completionChoice?: 'already_recorded' | 'collect_later' | undefined
  readonly collection?:
    | {
        readonly amountMinor: number
        readonly method: ExternalCollectionMethod
        readonly recordedAt: string
        readonly noteOrReference?: string | undefined
      }
    | undefined
}

export type ExternalCollectionMethod =
  | 'cash'
  | 'card_terminal'
  | 'bank_transfer'
  | 'other'

export type AppendExternalCollection = CommandBase & {
  readonly kind: 'append_collection'
  readonly appointmentId: string
  readonly expectedRevision: number
  readonly entry: {
    readonly kind: 'collection' | 'return'
    readonly amountMinor: number
    readonly method: ExternalCollectionMethod
    readonly recordedAt: string
    readonly noteOrReference?: string | undefined
    readonly offsetsEntryId?: string | undefined
    readonly correctionReason?: string | undefined
  }
}

export type MerchantAppointmentCommand =
  | CreateMerchantAppointment
  | CreateMerchantAppointmentSeries
  | EditMerchantAppointment
  | RescheduleMerchantAppointment
  | CancelMerchantAppointments
  | SetMerchantAppointmentOutcome
  | AppendExternalCollection

type ExistingMerchantAppointmentCommand = Exclude<
  MerchantAppointmentCommand,
  CreateMerchantAppointment | CreateMerchantAppointmentSeries
>

export type MerchantAppointmentCommandResult = {
  readonly operationId: string
  readonly appointmentIds: readonly string[]
  readonly revisions: Readonly<Record<string, number>>
  readonly replayed: boolean
  readonly seriesId?: string | undefined
}

export type AppointmentOperationHistoryEntry = {
  readonly operationId: string
  readonly command: string
  readonly actorId: string
  readonly impersonatedBy: string | null
  readonly priorRevision: number
  readonly resultingRevision: number
  readonly factsJson: string
  readonly reason: string | null
  readonly notificationChoiceJson: string | null
  readonly occurredAt: string
}

type MerchantAppointmentCommandsShape = {
  readonly execute: (
    command: MerchantAppointmentCommand
  ) => Effect.Effect<
    MerchantAppointmentCommandResult,
    CapabilityConflict | CapabilityDenied | CapabilityNotFound | CapabilityUnavailable,
    MerchantContext
  >
  readonly history: (
    appointmentId: string
  ) => Effect.Effect<
    readonly AppointmentOperationHistoryEntry[],
    CapabilityUnavailable,
    MerchantContext
  >
}

export class MerchantAppointmentCommands extends Context.Service<
  MerchantAppointmentCommands,
  MerchantAppointmentCommandsShape
>()('@b2b-saas-starter/capabilities/MerchantAppointmentCommands') {}

export const SeedMerchantAppointmentCommands: Layer.Layer<MerchantAppointmentCommands> =
  Layer.succeed(MerchantAppointmentCommands)({
    execute: () =>
      Effect.fail(
        new CapabilityUnavailable({
          capability: 'merchant-appointment-commands',
          reason: 'seed_mutations_disabled'
        })
      ),
    history: () => Effect.succeed([])
  })

type ServiceRow = {
  readonly id: string
  readonly name: string
  readonly priceMinor: number
  readonly currency: string
  readonly durationMinutes: number
  readonly bookingConfigJson: string | null
}

type ProviderRow = { readonly id: string; readonly displayName: string }
type AppointmentRow = {
  readonly id: string
  readonly merchantId: string
  readonly bookingPartyId: string | null
  readonly status: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
  readonly version: number
  readonly startsAt: string
  readonly endsAt: string
  readonly snapshot: string | StoredAppointmentSnapshot | null
}

const reject = (reason: string, currentRevision?: number, current?: unknown) =>
  new CapabilityConflict({
    reason,
    ...(currentRevision === undefined ? {} : { currentRevision }),
    ...(current === undefined ? {} : { current })
  })

const normalizeCustomer = (customer: MerchantAppointmentCustomer) => ({
  name: customer.name.trim(),
  email: customer.email?.trim().toLowerCase() ?? '',
  phone: customer.phone?.trim() || null,
  ...(customer.note?.trim() ? { note: customer.note.trim() } : {})
})

const jsonSnapshot = (value: AppointmentRow['snapshot']): StoredAppointmentSnapshot => {
  const decoded = typeof value === 'string' ? JSON.parse(value) : value
  if (!decoded) throw reject('appointment_snapshot_unavailable')
  return decoded
}

const commandFingerprint = async (command: MerchantAppointmentCommand) => {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(command))
  )
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const prepared = (raw: D1Database, statement: BatchStatement): D1PreparedStatement => {
  const query = statement.toSQL()
  return raw.prepare(query.sql).bind(...query.params)
}

const appointmentIdsFor = async (
  raw: D1Database,
  merchantId: string,
  command: CancelMerchantAppointments
) => {
  if (command.kind === 'cancel')
    return command.appointmentId ? [command.appointmentId] : []
  const column = command.kind === 'cancel_party' ? 'a.booking_party_id' : 'f.series_id'
  const target =
    command.kind === 'cancel_party' ? command.bookingPartyId : command.seriesId
  if (!target) return []
  const join =
    command.kind === 'cancel_party'
      ? ''
      : 'JOIN appointment_foundations f ON f.appointment_id = a.id'
  const result = await raw
    .prepare(
      `SELECT a.id FROM appointments a ${join} WHERE a.merchant_id = ? AND ${column} = ? AND a.status = 'scheduled' ORDER BY a.starts_at`
    )
    .bind(merchantId, target)
    .all<{ id: string }>()
  return result.results.map((row) => row.id)
}

const operationReason = (command: MerchantAppointmentCommand): string | null => {
  if ('overrideReason' in command) return command.overrideReason?.trim() || null
  if ('reason' in command) return command.reason?.trim() || null
  if ('privateNote' in command) return command.privateNote?.trim() || null
  if (command.kind === 'append_collection')
    return command.entry.correctionReason?.trim() || null
  return null
}

const notificationJson = (command: MerchantAppointmentCommand) =>
  'notification' in command && command.notification
    ? JSON.stringify(command.notification)
    : null

const validateNotification = (command: MerchantAppointmentCommand) => {
  const notification = 'notification' in command ? command.notification : undefined
  if (notification?.kind === 'suppress' && !notification.reason.trim())
    throw reject('notification_suppression_reason_required')
}

const assertAccess = async (
  raw: D1Database,
  merchantId: string,
  actorId: string,
  allowsRestricted: boolean
) => {
  const row = await raw
    .prepare(`SELECT ms.status,
      EXISTS (SELECT 1 FROM merchant_access_holds h WHERE h.merchant_id = ?1 AND h.user_id = ?2 AND h.released_at IS NULL) held
      FROM merchant_subscriptions ms WHERE ms.merchant_id = ?1 LIMIT 1`)
    .bind(merchantId, actorId)
    .first<{ status: string; held: number }>()
  if (!row) throw new CapabilityDenied({ reason: 'authority_not_found' })
  if (row.held === 1) throw new CapabilityDenied({ reason: 'merchant_access_held' })
  if ((row.status === 'restricted' || row.status === 'cancelled') && !allowsRestricted)
    throw new CapabilityDenied({ reason: 'restricted_access' })
}

const loadCatalog = async (
  raw: D1Database,
  merchantId: string,
  serviceIds: readonly string[]
) => {
  if (serviceIds.length === 0 || new Set(serviceIds).size !== serviceIds.length)
    throw reject('services_invalid')
  const placeholders = serviceIds.map(() => '?').join(',')
  const services = await raw
    .prepare(`SELECT id, name, price_minor priceMinor, currency, duration_minutes durationMinutes,
      json(booking_config_json) bookingConfigJson FROM services
      WHERE merchant_id = ? AND status = 'active' AND id IN (${placeholders})`)
    .bind(merchantId, ...serviceIds)
    .all<ServiceRow>()
  const byId = new Map(services.results.map((service) => [service.id, service]))
  const ordered = serviceIds
    .map((id) => byId.get(id))
    .filter((row): row is ServiceRow => Boolean(row))
  if (ordered.length !== serviceIds.length) throw reject('service_unavailable')
  const currencies = new Set(ordered.map((service) => service.currency))
  if (currencies.size !== 1) throw reject('service_currency_mismatch')
  const provider = await raw
    .prepare(`SELECT p.id, p.display_name displayName FROM providers p
      WHERE p.merchant_id = ? AND p.status = 'active' AND p.is_default = 1
      AND (SELECT COUNT(*) FROM provider_service_eligibility e
        WHERE e.merchant_id = p.merchant_id AND e.provider_id = p.id
        AND e.service_id IN (${placeholders})) = ? LIMIT 1`)
    .bind(merchantId, ...serviceIds, serviceIds.length)
    .first<ProviderRow>()
  if (!provider) throw reject('owner_provider_unavailable')
  return { services: ordered, provider }
}

const makeSnapshot = (
  merchantTimezone: string,
  customer: MerchantAppointmentCustomer,
  startsAt: string,
  endsAt: string,
  catalog: Awaited<ReturnType<typeof loadCatalog>>
): StoredAppointmentSnapshot => {
  const serviceSnapshots = catalog.services.map((service, index) => {
    const buffers = decodePersistedServiceBuffers(
      service.bookingConfigJson ? JSON.parse(service.bookingConfigJson) : undefined
    )
    if (!buffers) throw reject('service_buffers_invalid')
    return {
      id: service.id,
      role: index === 0 ? ('primary' as const) : ('additional' as const),
      name: service.name,
      durationMinutes: service.durationMinutes,
      beforeBufferMinutes: buffers.beforeBufferMinutes,
      afterBufferMinutes: buffers.afterBufferMinutes,
      priceMinor: service.priceMinor,
      currency: service.currency
    }
  })
  const beforeBufferMinutes = Math.max(
    ...serviceSnapshots.map((service) => service.beforeBufferMinutes)
  )
  const afterBufferMinutes = Math.max(
    ...serviceSnapshots.map((service) => service.afterBufferMinutes)
  )
  return {
    startsAt,
    endsAt,
    providerPreference: { kind: 'specific', providerId: catalog.provider.id },
    assignedProvider: catalog.provider,
    services: serviceSnapshots,
    durationMinutes: serviceSnapshots.reduce(
      (total, service) => total + service.durationMinutes,
      0
    ),
    beforeBufferMinutes,
    afterBufferMinutes,
    occupiedStartsAt: new Date(
      Date.parse(startsAt) - beforeBufferMinutes * 60_000
    ).toISOString(),
    occupiedEndsAt: new Date(
      Date.parse(endsAt) + afterBufferMinutes * 60_000
    ).toISOString(),
    currency: serviceSnapshots[0]!.currency,
    totalMinor: serviceSnapshots.reduce(
      (total, service) => total + service.priceMinor,
      0
    ),
    merchantTimezone,
    customerDetails: normalizeCustomer(customer),
    checkoutPath: 'pay_in_person'
  }
}

const localOccurrence = (instant: string, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(instant))
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    time: `${read('hour')}:${read('minute')}`,
    weekday: read('weekday')
  }
}

const validateSeriesCadence = (
  command: CreateMerchantAppointmentSeries,
  timezone: string
) => {
  const local = command.occurrences.map((item) =>
    localOccurrence(item.startsAt, timezone)
  )
  const first = local[0]!
  if (
    local.some(
      (item) => item.time !== command.localStartTime || item.weekday !== first.weekday
    )
  )
    throw reject('series_cadence_invalid')
  for (let index = 1; index < local.length; index += 1) {
    const prior = Date.parse(`${local[index - 1]!.date}T12:00:00.000Z`)
    const current = Date.parse(`${local[index]!.date}T12:00:00.000Z`)
    if ((current - prior) / 86_400_000 !== command.intervalWeeks * 7)
      throw reject('series_cadence_invalid')
  }
}

const requiresScheduleWarning = async (
  raw: D1Database,
  merchantId: string,
  timezone: string,
  providerId: string,
  snapshot: StoredAppointmentSnapshot
) => {
  const start = localOccurrence(snapshot.startsAt, timezone)
  const end = localOccurrence(snapshot.endsAt, timezone)
  const weekday = new Date(`${start.date}T12:00:00.000Z`).getUTCDay()
  const exception = await raw
    .prepare(`SELECT kind, intervals_json intervalsJson FROM schedule_exceptions
      WHERE merchant_id = ? AND local_date = ? LIMIT 1`)
    .bind(merchantId, start.date)
    .first<{ kind: 'closed' | 'replacement_hours'; intervalsJson: string }>()
  const inside = (intervals: readonly { startTime: string; endTime: string }[]) =>
    start.date === end.date &&
    intervals.some(
      (interval) => interval.startTime <= start.time && interval.endTime >= end.time
    )
  let insideWorkingTime = false
  if (exception?.kind === 'replacement_hours') {
    try {
      insideWorkingTime = inside(JSON.parse(exception.intervalsJson))
    } catch {
      insideWorkingTime = false
    }
  } else if (exception?.kind !== 'closed') {
    const rules = await raw
      .prepare(`SELECT start_time startTime, end_time endTime FROM schedule_rules
        WHERE merchant_id = ? AND provider_id = ? AND weekday = ?`)
      .bind(merchantId, providerId, weekday)
      .all<{ startTime: string; endTime: string }>()
    insideWorkingTime = inside(rules.results)
  }
  const blocked = await raw
    .prepare(`SELECT 1 blocked FROM blocked_times
      WHERE merchant_id = ? AND starts_at < ? AND ends_at > ? LIMIT 1`)
    .bind(merchantId, snapshot.occupiedEndsAt, snapshot.occupiedStartsAt)
    .first<{ blocked: number }>()
  return !insideWorkingTime || Boolean(blocked)
}

const historyStatement = (
  raw: D1Database,
  input: {
    merchantId: string
    appointmentId: string
    operationId: string
    command: MerchantAppointmentCommand
    actorId: string
    impersonatedBy: string | null
    priorRevision: number
    resultingRevision: number
    facts: unknown
    now: string
  }
) =>
  raw
    .prepare(`INSERT INTO appointment_operation_history
  (id, merchant_id, appointment_id, operation_id, command, actor_id, impersonated_by,
   prior_revision, resulting_revision, facts_json, reason, notification_choice_json, occurred_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      newCapabilityId('aoh'),
      input.merchantId,
      input.appointmentId,
      input.operationId,
      input.command.kind,
      input.actorId,
      input.impersonatedBy,
      input.priorRevision,
      input.resultingRevision,
      JSON.stringify(input.facts),
      operationReason(input.command),
      notificationJson(input.command),
      input.now,
      input.now
    )

const commandStatement = (
  raw: D1Database,
  merchantId: string,
  command: MerchantAppointmentCommand,
  fingerprint: string,
  operationId: string,
  result: MerchantAppointmentCommandResult,
  now: string
) =>
  raw
    .prepare(`INSERT INTO appointment_operation_commands
  (id, merchant_id, idempotency_key, payload_fingerprint, operation_id, result_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      newCapabilityId('aoc'),
      merchantId,
      command.idempotencyKey,
      fingerprint,
      operationId,
      JSON.stringify(result),
      now
    )

const mapFailure = (cause: unknown) => {
  if (
    cause instanceof CapabilityConflict ||
    cause instanceof CapabilityDenied ||
    cause instanceof CapabilityNotFound ||
    cause instanceof CapabilityUnavailable
  )
    return cause
  const reason = cause instanceof Error ? cause.message : String(cause)
  return reason.includes('capability_transaction_guards_accepted') ||
    reason.includes('accepted = 1')
    ? reject('concurrent_appointment_conflict')
    : new CapabilityUnavailable({ capability: 'merchant-appointment-commands', reason })
}

export const liveMerchantAppointmentCommands = (options?: {
  readonly impersonatedBy?: string | null | undefined
}): Layer.Layer<MerchantAppointmentCommands, never, Database> =>
  Layer.effect(
    MerchantAppointmentCommands,
    Effect.map(Database, (db) => {
      const raw = rawD1FromDatabase(db)
      const execute: MerchantAppointmentCommandsShape['execute'] = (command) =>
        Effect.flatMap(MerchantContext, (merchant) =>
          Effect.tryPromise({
            try: async () => {
              validateNotification(command)
              if (command.kind === 'create' && !command.notification)
                throw reject('notification_choice_required')
              if (!command.idempotencyKey.trim())
                throw reject('idempotency_key_required')
              const fingerprint = await commandFingerprint(command)
              const replay = await raw
                .prepare(`SELECT payload_fingerprint fingerprint, result_json resultJson
              FROM appointment_operation_commands WHERE merchant_id = ? AND idempotency_key = ? LIMIT 1`)
                .bind(merchant.id, command.idempotencyKey)
                .first<{ fingerprint: string; resultJson: string }>()
              if (replay) {
                if (replay.fingerprint !== fingerprint)
                  throw reject('idempotency_key_reused')
                return {
                  ...(JSON.parse(
                    replay.resultJson
                  ) as MerchantAppointmentCommandResult),
                  replayed: true
                }
              }
              const actorId = merchant.actorUserId
              if (!actorId)
                throw new CapabilityDenied({ reason: 'owner_session_required' })
              const createLike =
                command.kind === 'create' ||
                command.kind === 'record_completed' ||
                command.kind === 'create_series'
              await assertAccess(raw, merchant.id, actorId, !createLike)
              const now = new Date().toISOString()
              const operationId = newCapabilityId('apo')

              if (
                command.kind === 'create' ||
                command.kind === 'record_completed' ||
                command.kind === 'create_series'
              ) {
                const customer = normalizeCustomer(command.customer)
                if (!customer.name) throw reject('customer_name_required')
                const catalog = await loadCatalog(raw, merchant.id, command.serviceIds)
                const occurrences =
                  command.kind === 'create_series'
                    ? command.occurrences
                    : [
                        {
                          appointmentId: command.appointmentId,
                          startsAt: command.startsAt,
                          endsAt: command.endsAt
                        }
                      ]
                if (
                  command.kind === 'create_series' &&
                  (occurrences.length < 2 ||
                    occurrences.length > 52 ||
                    command.intervalWeeks < 1 ||
                    command.intervalWeeks > 8)
                )
                  throw reject('series_rule_invalid')
                if (command.kind === 'create_series')
                  validateSeriesCadence(command, merchant.timezone)
                if (
                  command.kind === 'record_completed' &&
                  (!command.completionReason?.trim() ||
                    !command.completionCollection ||
                    occurrences.some(
                      (item) => Date.parse(item.endsAt) > Date.parse(now)
                    ))
                )
                  throw reject('record_completed_invalid')
                if (
                  command.kind === 'create' &&
                  occurrences.some(
                    (item) => Date.parse(item.startsAt) < Date.parse(now)
                  )
                )
                  throw reject('appointment_start_in_past')
                const appointmentIds = occurrences.map(
                  (item) => item.appointmentId ?? newCapabilityId('apt')
                )
                const snapshots = occurrences.map((item) =>
                  makeSnapshot(
                    merchant.timezone,
                    command.customer,
                    item.startsAt,
                    item.endsAt,
                    catalog
                  )
                )
                if (
                  command.kind === 'record_completed' &&
                  !command.warningAcknowledged
                ) {
                  const historicalOverlap = await raw
                    .prepare(`SELECT 1 overlapFound FROM appointments
                      WHERE merchant_id = ? AND provider_id = ?
                      AND starts_at < ? AND ends_at > ? LIMIT 1`)
                    .bind(
                      merchant.id,
                      catalog.provider.id,
                      occurrences[0]!.endsAt,
                      occurrences[0]!.startsAt
                    )
                    .first<{ overlapFound: number }>()
                  if (historicalOverlap)
                    throw reject('historical_overlap_acknowledgement_required')
                }
                if (
                  command.kind !== 'record_completed' &&
                  !command.warningAcknowledged &&
                  (
                    await Promise.all(
                      snapshots.map((snapshot) =>
                        requiresScheduleWarning(
                          raw,
                          merchant.id,
                          merchant.timezone,
                          catalog.provider.id,
                          snapshot
                        )
                      )
                    )
                  ).some(Boolean)
                )
                  throw reject('schedule_warning_acknowledgement_required')
                const seriesId =
                  command.kind === 'create_series'
                    ? (command.seriesId ?? newCapabilityId('aps'))
                    : undefined
                const revisions = Object.fromEntries(
                  appointmentIds.map((id) => [id, 1])
                )
                const result: MerchantAppointmentCommandResult = {
                  operationId,
                  appointmentIds,
                  revisions,
                  replayed: false,
                  ...(seriesId ? { seriesId } : {})
                }
                const statements: D1PreparedStatement[] = []
                const accessGuardId = `guard:${operationId}:access`
                statements.push(
                  raw
                    .prepare(`INSERT INTO capability_transaction_guards (id, accepted)
                VALUES (?, CASE WHEN EXISTS (
                  SELECT 1 FROM merchant_subscriptions ms WHERE ms.merchant_id = ?
                  AND ms.status IN ('trialing','active','grace')
                  AND NOT EXISTS (SELECT 1 FROM merchant_access_holds h
                    WHERE h.merchant_id = ms.merchant_id AND h.user_id = ? AND h.released_at IS NULL)
                ) THEN 1 ELSE 0 END)`)
                    .bind(accessGuardId, merchant.id, actorId)
                )
                if (command.kind === 'create_series') {
                  statements.push(
                    raw
                      .prepare(
                        `INSERT INTO capability_transaction_guards (id, accepted) VALUES (?, 1)`
                      )
                      .bind(`appointment-series-membership:${seriesId}`),
                    raw
                      .prepare(`INSERT INTO appointment_series
                    (id, merchant_id, idempotency_key, service_snapshot_json, customer_snapshot_json,
                     weekday, local_start_time, interval_weeks, occurrence_count, status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
                      .bind(
                        seriesId!,
                        merchant.id,
                        command.idempotencyKey,
                        JSON.stringify(snapshots[0]!.services),
                        JSON.stringify(customer),
                        new Date(
                          `${localOccurrence(occurrences[0]!.startsAt, merchant.timezone).date}T12:00:00.000Z`
                        ).getUTCDay(),
                        command.localStartTime,
                        command.intervalWeeks,
                        occurrences.length,
                        now,
                        now
                      )
                  )
                }
                for (const [index, appointmentId] of appointmentIds.entries()) {
                  const occurrence = occurrences[index]!
                  const snapshot = snapshots[index]!
                  if (Date.parse(occurrence.startsAt) >= Date.parse(occurrence.endsAt))
                    throw reject('appointment_interval_invalid')
                  const historical = command.kind === 'record_completed'
                  statements.push(
                    raw
                      .prepare(`INSERT INTO capability_transaction_guards (id, accepted)
                  VALUES (?, CASE WHEN ? OR NOT EXISTS (
                    SELECT 1 FROM appointments a WHERE a.merchant_id = ? AND a.provider_id = ?
                    AND a.status = 'scheduled'
                    AND COALESCE(json_extract(a.snapshot, '$.occupiedStartsAt'), a.starts_at) < ?
                    AND COALESCE(json_extract(a.snapshot, '$.occupiedEndsAt'), a.ends_at) > ?
                  ) THEN 1 ELSE 0 END)`)
                      .bind(
                        `guard:${operationId}:${appointmentId}`,
                        historical ? 1 : 0,
                        merchant.id,
                        catalog.provider.id,
                        snapshot.occupiedEndsAt,
                        snapshot.occupiedStartsAt
                      )
                  )
                  statements.push(
                    raw
                      .prepare(`INSERT INTO appointments
                  (id, merchant_id, provider_id, status, version, starts_at, ends_at, snapshot, created_at, updated_at)
                  VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`)
                      .bind(
                        appointmentId,
                        merchant.id,
                        catalog.provider.id,
                        historical ? 'completed' : 'scheduled',
                        occurrence.startsAt,
                        occurrence.endsAt,
                        JSON.stringify(snapshot),
                        now,
                        now
                      )
                  )
                  if (
                    command.kind === 'record_completed' &&
                    command.completionCollection?.kind === 'collected'
                  ) {
                    if (command.completionCollection.amountMinor > snapshot.totalMinor)
                      throw reject('collection_net_out_of_bounds')
                    statements.push(
                      raw
                        .prepare(`INSERT INTO external_collections
                    (id, merchant_id, appointment_id, idempotency_key, kind, method, amount_minor, currency,
                     actor_id, note_or_reference, recorded_at, created_at)
                    VALUES (?, ?, ?, ?, 'collection', ?, ?, ?, ?, ?, ?, ?)`)
                        .bind(
                          newCapabilityId('exc'),
                          merchant.id,
                          appointmentId,
                          `${command.idempotencyKey}:${appointmentId}`,
                          command.completionCollection.method,
                          command.completionCollection.amountMinor,
                          snapshot.currency,
                          actorId,
                          command.completionCollection.noteOrReference ?? null,
                          command.completionCollection.recordedAt,
                          now
                        )
                    )
                  }
                }
                const associations = await Effect.runPromise(
                  prepareAppointmentCustomerAssociationBatch(
                    db,
                    appointmentIds.map((id) => ({
                      merchantId: merchant.id,
                      appointment: {
                        id,
                        ...(command.customerRecordId
                          ? { selectedCustomerRecordId: command.customerRecordId }
                          : {}),
                        ...(command.kind !== 'create_series' && command.appointmentNote
                          ? { customerNote: command.appointmentNote }
                          : {}),
                        ...(seriesId
                          ? {
                              series: {
                                id: seriesId,
                                position: appointmentIds.indexOf(id)
                              }
                            }
                          : {}),
                        details: { ...customer, email: customer.email || null }
                      },
                      origin:
                        command.kind === 'record_completed'
                          ? ('record_completed' as const)
                          : ('merchant_created' as const),
                      actor: {
                        merchantMemberId: actorId,
                        impersonatedBy: options?.impersonatedBy ?? null
                      },
                      now
                    }))
                  )
                )
                statements.push(
                  ...associations.map((statement) => prepared(raw, statement))
                )
                for (const [index, appointmentId] of appointmentIds.entries()) {
                  if (seriesId)
                    statements.push(
                      raw
                        .prepare(
                          `UPDATE appointment_foundations SET series_id = ?, series_position = ? WHERE appointment_id = ? AND merchant_id = ?`
                        )
                        .bind(seriesId, index, appointmentId, merchant.id)
                    )
                  statements.push(
                    historyStatement(raw, {
                      merchantId: merchant.id,
                      appointmentId,
                      operationId,
                      command,
                      actorId,
                      impersonatedBy: options?.impersonatedBy ?? null,
                      priorRevision: 0,
                      resultingRevision: 1,
                      facts: {
                        after: snapshots[index],
                        status:
                          command.kind === 'record_completed'
                            ? 'completed'
                            : 'scheduled'
                      },
                      now
                    })
                  )
                  statements.push(
                    raw
                      .prepare(
                        `DELETE FROM time_slot_holds WHERE merchant_id = ? AND provider_id = ? AND starts_at < ? AND ends_at > ?`
                      )
                      .bind(
                        merchant.id,
                        catalog.provider.id,
                        snapshots[index]!.occupiedEndsAt,
                        snapshots[index]!.occupiedStartsAt
                      )
                  )

                  statements.push(
                    raw
                      .prepare(`DELETE FROM capability_transaction_guards WHERE id = ?`)
                      .bind(`guard:${operationId}:${appointmentId}`)
                  )
                }
                if (seriesId)
                  statements.push(
                    raw
                      .prepare(`DELETE FROM capability_transaction_guards WHERE id = ?`)
                      .bind(`appointment-series-membership:${seriesId}`)
                  )
                statements.push(
                  raw
                    .prepare(`DELETE FROM capability_transaction_guards WHERE id = ?`)
                    .bind(accessGuardId)
                )
                statements.push(
                  commandStatement(
                    raw,
                    merchant.id,
                    command,
                    fingerprint,
                    operationId,
                    result,
                    now
                  )
                )
                await raw.batch(statements)
                return result
              }

              const mutationCommand = command as ExistingMerchantAppointmentCommand
              let targetIds: string[]
              if (
                mutationCommand.kind === 'cancel' ||
                mutationCommand.kind === 'cancel_party' ||
                mutationCommand.kind === 'cancel_remaining_series'
              )
                targetIds = await appointmentIdsFor(raw, merchant.id, mutationCommand)
              else targetIds = [mutationCommand.appointmentId!]
              if (targetIds.length === 0)
                throw new CapabilityNotFound({ resource: 'appointment' })
              const placeholders = targetIds.map(() => '?').join(',')
              const rows = await raw
                .prepare(`SELECT id, merchant_id merchantId, booking_party_id bookingPartyId,
              status, version, starts_at startsAt, ends_at endsAt, snapshot
              FROM appointments WHERE merchant_id = ? AND id IN (${placeholders}) ORDER BY starts_at`)
                .bind(merchant.id, ...targetIds)
                .all<AppointmentRow>()
              if (rows.results.length !== targetIds.length)
                throw new CapabilityNotFound({ resource: 'appointment' })
              const rowById = new Map(rows.results.map((row) => [row.id, row]))
              const statements: D1PreparedStatement[] = []
              const accessGuardId = `guard:${operationId}:access`
              statements.push(
                raw
                  .prepare(`INSERT INTO capability_transaction_guards (id, accepted)
              VALUES (?, CASE WHEN EXISTS (
                SELECT 1 FROM merchant_subscriptions ms WHERE ms.merchant_id = ?
                AND NOT EXISTS (SELECT 1 FROM merchant_access_holds h
                  WHERE h.merchant_id = ms.merchant_id AND h.user_id = ? AND h.released_at IS NULL)
              ) THEN 1 ELSE 0 END)`)
                  .bind(accessGuardId, merchant.id, actorId)
              )
              const revisions: Record<string, number> = {}
              for (const appointmentId of targetIds) {
                const row = rowById.get(appointmentId)!
                const expected =
                  'expectedRevisions' in mutationCommand
                    ? mutationCommand.expectedRevisions[appointmentId]
                    : mutationCommand.expectedRevision
                if (expected !== row.version)
                  throw reject('stale_revision', row.version, {
                    id: row.id,
                    status: row.status,
                    revision: row.version,
                    startsAt: row.startsAt,
                    endsAt: row.endsAt,
                    snapshot: jsonSnapshot(row.snapshot)
                  })
                const revisionGuardId = `guard:${operationId}:revision:${appointmentId}`
                statements.push(
                  raw
                    .prepare(`INSERT INTO capability_transaction_guards (id, accepted)
                VALUES (?, CASE WHEN EXISTS (SELECT 1 FROM appointments
                  WHERE id = ? AND merchant_id = ? AND version = ?) THEN 1 ELSE 0 END)`)
                    .bind(revisionGuardId, appointmentId, merchant.id, row.version)
                )
                const snapshot = jsonSnapshot(row.snapshot)
                let nextSnapshot = snapshot
                let nextStatus = row.status
                let startsAt = row.startsAt
                let endsAt = row.endsAt
                if (mutationCommand.kind === 'edit')
                  nextSnapshot = {
                    ...snapshot,
                    customerDetails: normalizeCustomer(mutationCommand.customer)
                  }
                if (mutationCommand.kind === 'reschedule') {
                  if (row.status !== 'scheduled')
                    throw reject('appointment_not_scheduled')
                  startsAt = mutationCommand.startsAt
                  endsAt = mutationCommand.endsAt
                  if (Date.parse(startsAt) < Date.parse(now))
                    throw reject('appointment_start_in_past')
                  const catalog = mutationCommand.serviceIds
                    ? await loadCatalog(raw, merchant.id, mutationCommand.serviceIds)
                    : null
                  nextSnapshot = catalog
                    ? makeSnapshot(
                        merchant.timezone,
                        snapshot.customerDetails,
                        startsAt,
                        endsAt,
                        catalog
                      )
                    : {
                        ...snapshot,
                        startsAt,
                        endsAt,
                        occupiedStartsAt: new Date(
                          Date.parse(startsAt) - snapshot.beforeBufferMinutes * 60_000
                        ).toISOString(),
                        occupiedEndsAt: new Date(
                          Date.parse(endsAt) + snapshot.afterBufferMinutes * 60_000
                        ).toISOString()
                      }
                  if (
                    !mutationCommand.warningAcknowledged &&
                    (await requiresScheduleWarning(
                      raw,
                      merchant.id,
                      merchant.timezone,
                      nextSnapshot.assignedProvider.id,
                      nextSnapshot
                    ))
                  )
                    throw reject('schedule_warning_acknowledgement_required')
                  statements.push(
                    raw
                      .prepare(`INSERT INTO capability_transaction_guards (id, accepted)
                  VALUES (?, CASE WHEN NOT EXISTS (SELECT 1 FROM appointments a
                    WHERE a.merchant_id = ? AND a.provider_id = ? AND a.id <> ? AND a.status = 'scheduled'
                    AND COALESCE(json_extract(a.snapshot, '$.occupiedStartsAt'), a.starts_at) < ?
                    AND COALESCE(json_extract(a.snapshot, '$.occupiedEndsAt'), a.ends_at) > ?) THEN 1 ELSE 0 END)`)
                      .bind(
                        `guard:${operationId}:overlap:${appointmentId}`,
                        merchant.id,
                        snapshot.assignedProvider.id,
                        appointmentId,
                        nextSnapshot.occupiedEndsAt,
                        nextSnapshot.occupiedStartsAt
                      )
                  )
                }
                if (
                  mutationCommand.kind === 'cancel' ||
                  mutationCommand.kind === 'cancel_party' ||
                  mutationCommand.kind === 'cancel_remaining_series'
                ) {
                  if (row.status !== 'scheduled')
                    throw reject('appointment_not_scheduled')
                  if (
                    mutationCommand.category === 'other' &&
                    !mutationCommand.privateNote?.trim()
                  )
                    throw reject('cancellation_note_required')
                  nextStatus = 'cancelled'
                }
                if (
                  mutationCommand.kind === 'complete' ||
                  mutationCommand.kind === 'no_show' ||
                  mutationCommand.kind === 'correct_outcome'
                ) {
                  const requested =
                    mutationCommand.kind === 'complete'
                      ? 'completed'
                      : mutationCommand.kind === 'no_show'
                        ? 'no_show'
                        : mutationCommand.outcome
                  if (!requested) throw reject('outcome_required')
                  if (mutationCommand.kind === 'correct_outcome') {
                    if (
                      (row.status !== 'completed' && row.status !== 'no_show') ||
                      !mutationCommand.reason?.trim()
                    )
                      throw reject('outcome_correction_invalid')
                  } else if (
                    row.status !== 'scheduled' ||
                    Date.parse(now) < Date.parse(row.startsAt)
                  )
                    throw reject('outcome_not_available')
                  if (
                    mutationCommand.kind === 'complete' &&
                    Boolean(mutationCommand.collection) ===
                      Boolean(mutationCommand.completionChoice)
                  )
                    throw reject('completion_collection_choice_required')
                  nextStatus = requested
                }
                const nextRevision = row.version + 1
                if (mutationCommand.kind === 'edit') {
                  const beforeEmail = snapshot.customerDetails.email
                    .trim()
                    .toLowerCase()
                  const beforePhone = snapshot.customerDetails.phone?.trim() || null
                  const afterEmail = nextSnapshot.customerDetails.email
                    .trim()
                    .toLowerCase()
                  const afterPhone = nextSnapshot.customerDetails.phone?.trim() || null
                  const destinationChanged =
                    beforeEmail !== afterEmail || beforePhone !== afterPhone
                  if (destinationChanged && !mutationCommand.notification)
                    throw reject('destination_notification_choice_required')
                  if (destinationChanged)
                    statements.push(
                      raw
                        .prepare(
                          `UPDATE confirmation_access SET revoked_at = ? WHERE appointment_id = ? AND revoked_at IS NULL`
                        )
                        .bind(now, appointmentId)
                    )
                  statements.push(
                    raw
                      .prepare(
                        `UPDATE appointment_foundations SET customer_note = ? WHERE appointment_id = ? AND merchant_id = ?`
                      )
                      .bind(
                        mutationCommand.appointmentNote?.trim() || null,
                        appointmentId,
                        merchant.id
                      )
                  )
                }
                statements.push(
                  raw
                    .prepare(`UPDATE appointments SET status = ?, version = ?, starts_at = ?, ends_at = ?, snapshot = ?, updated_at = ?
                WHERE id = ? AND merchant_id = ? AND version = ?`)
                    .bind(
                      nextStatus,
                      nextRevision,
                      startsAt,
                      endsAt,
                      JSON.stringify(nextSnapshot),
                      now,
                      appointmentId,
                      merchant.id,
                      row.version
                    )
                )

                const collection =
                  mutationCommand.kind === 'append_collection'
                    ? mutationCommand.entry
                    : mutationCommand.kind === 'complete' && mutationCommand.collection
                      ? { ...mutationCommand.collection, kind: 'collection' as const }
                      : undefined
                const returnedAmount =
                  mutationCommand.kind === 'cancel' ||
                  mutationCommand.kind === 'cancel_party' ||
                  mutationCommand.kind === 'cancel_remaining_series'
                    ? mutationCommand.returnedAmounts?.[appointmentId]
                    : undefined
                if (collection || returnedAmount) {
                  const amountMinor = collection?.amountMinor ?? returnedAmount!
                  if (!Number.isInteger(amountMinor) || amountMinor <= 0)
                    throw reject('collection_amount_invalid')
                  const net = await raw
                    .prepare(`SELECT COALESCE(SUM(CASE kind WHEN 'collection' THEN amount_minor ELSE -amount_minor END), 0) net
                  FROM external_collections WHERE merchant_id = ? AND appointment_id = ?`)
                    .bind(merchant.id, appointmentId)
                    .first<{ net: number }>()
                  const collectionKind = collection?.kind ?? 'return'
                  const resultingNet =
                    (net?.net ?? 0) +
                    (collectionKind === 'collection' ? amountMinor : -amountMinor)
                  if (resultingNet < 0 || resultingNet > snapshot.totalMinor)
                    throw reject('collection_net_out_of_bounds')
                  if (
                    collection?.offsetsEntryId &&
                    !collection.correctionReason?.trim()
                  )
                    throw reject('collection_correction_reason_required')
                  const collectionGuardId = `guard:${operationId}:collection:${appointmentId}`
                  statements.push(
                    raw
                      .prepare(`INSERT INTO capability_transaction_guards (id, accepted)
                  VALUES (?, CASE WHEN (
                    SELECT COALESCE(SUM(CASE kind WHEN 'collection' THEN amount_minor ELSE -amount_minor END), 0)
                    FROM external_collections WHERE merchant_id = ? AND appointment_id = ?
                  ) + ? BETWEEN 0 AND ? THEN 1 ELSE 0 END)`)
                      .bind(
                        collectionGuardId,
                        merchant.id,
                        appointmentId,
                        collectionKind === 'collection' ? amountMinor : -amountMinor,
                        snapshot.totalMinor
                      )
                  )
                  statements.push(
                    raw
                      .prepare(`INSERT INTO external_collections
                  (id, merchant_id, appointment_id, idempotency_key, kind, method, amount_minor, currency, actor_id,
                   note_or_reference, offsets_entry_id, correction_reason, recorded_at, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                      .bind(
                        newCapabilityId('exc'),
                        merchant.id,
                        appointmentId,
                        `${command.idempotencyKey}:${appointmentId}`,
                        collectionKind,
                        collection?.method ?? 'other',
                        amountMinor,
                        snapshot.currency,
                        actorId,
                        collection?.noteOrReference ?? null,
                        collection?.offsetsEntryId ?? null,
                        collection?.correctionReason ?? null,
                        collection?.recordedAt ?? now,
                        now
                      )
                  )
                  statements.push(
                    raw
                      .prepare(`DELETE FROM capability_transaction_guards WHERE id = ?`)
                      .bind(collectionGuardId)
                  )
                }
                statements.push(
                  historyStatement(raw, {
                    merchantId: merchant.id,
                    appointmentId,
                    operationId,
                    command,
                    actorId,
                    impersonatedBy: options?.impersonatedBy ?? null,
                    priorRevision: row.version,
                    resultingRevision: nextRevision,
                    facts: {
                      before: {
                        status: row.status,
                        startsAt: row.startsAt,
                        endsAt: row.endsAt,
                        snapshot
                      },
                      after: {
                        status: nextStatus,
                        startsAt,
                        endsAt,
                        snapshot: nextSnapshot
                      }
                    },
                    now
                  })
                )
                if (nextStatus !== 'scheduled')
                  statements.push(
                    raw
                      .prepare(
                        `UPDATE scheduled_work SET status = 'cancelled', updated_at = ? WHERE source_type = 'appointment' AND source_id = ? AND status = 'pending'`
                      )
                      .bind(now, appointmentId)
                  )
                if (mutationCommand.kind === 'reschedule') {
                  statements.push(
                    raw
                      .prepare(
                        `DELETE FROM time_slot_holds WHERE merchant_id = ? AND provider_id = ? AND starts_at < ? AND ends_at > ?`
                      )
                      .bind(
                        merchant.id,
                        nextSnapshot.assignedProvider.id,
                        nextSnapshot.occupiedEndsAt,
                        nextSnapshot.occupiedStartsAt
                      )
                  )
                  statements.push(
                    raw
                      .prepare(`DELETE FROM capability_transaction_guards WHERE id = ?`)
                      .bind(`guard:${operationId}:overlap:${appointmentId}`)
                  )
                }
                statements.push(
                  raw
                    .prepare(`DELETE FROM capability_transaction_guards WHERE id = ?`)
                    .bind(revisionGuardId)
                )
                revisions[appointmentId] = nextRevision
              }
              if (
                mutationCommand.kind === 'cancel_remaining_series' &&
                mutationCommand.seriesId
              )
                statements.push(
                  raw
                    .prepare(
                      `UPDATE appointment_series SET status = 'cancelled_remaining', updated_at = ? WHERE id = ? AND merchant_id = ?`
                    )
                    .bind(now, mutationCommand.seriesId, merchant.id)
                )
              const result: MerchantAppointmentCommandResult = {
                operationId,
                appointmentIds: targetIds,
                revisions,
                replayed: false
              }
              statements.push(
                commandStatement(
                  raw,
                  merchant.id,
                  command,
                  fingerprint,
                  operationId,
                  result,
                  now
                )
              )
              statements.push(
                raw
                  .prepare(`DELETE FROM capability_transaction_guards WHERE id = ?`)
                  .bind(accessGuardId)
              )
              await raw.batch(statements)
              return result
            },
            catch: mapFailure
          })
        )
      return {
        execute,
        history: (appointmentId) =>
          Effect.flatMap(MerchantContext, (merchant) =>
            Effect.tryPromise({
              try: async () => {
                const result = await raw
                  .prepare(`SELECT operation_id operationId, command, actor_id actorId,
            impersonated_by impersonatedBy, prior_revision priorRevision, resulting_revision resultingRevision,
            facts_json factsJson, reason, notification_choice_json notificationChoiceJson, occurred_at occurredAt
            FROM appointment_operation_history WHERE merchant_id = ? AND appointment_id = ? ORDER BY resulting_revision`)
                  .bind(merchant.id, appointmentId)
                  .all<AppointmentOperationHistoryEntry>()
                return result.results
              },
              catch: (cause) =>
                new CapabilityUnavailable({
                  capability: 'merchant-appointment-history',
                  reason: cause instanceof Error ? cause.message : String(cause)
                })
            })
          )
      }
    })
  )

export const LiveMerchantAppointmentCommands = liveMerchantAppointmentCommands()
