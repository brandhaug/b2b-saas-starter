import { type JsonObject } from '@b2b-saas-starter/db/schema'
import { auditActorTypes, type AuditActorTypeValue } from '@b2b-saas-starter/db/enums'
import { type SQL } from 'drizzle-orm'
import { type BatchStatement } from '@b2b-saas-starter/db/service'
import { Context, DateTime, Effect, Layer, Schema } from 'effect'

import { AuditEventMetadata, decodeAuditEventMetadata } from './audit-event-metadata.ts'

import { type CapabilityUnavailable } from '../errors.ts'
import {
  seedKeysetPage,
  type KeysetCursorPosition,
  type Page
} from '../internal/keyset-cursor.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { type AuditEventType, type AuditTargetType } from './audit-event-taxonomy.ts'
import { WorkspaceContext } from '../workspace-context.ts'

export const AuditEvent = Schema.Struct({
  id: Schema.String,
  eventType: Schema.String,
  targetType: Schema.String,
  targetId: Schema.NullOr(Schema.String),
  actor: Schema.String,
  // Lenient like `eventType`: the read never breaks on a row the taxonomy
  // has not met, and the UI's label map prettifies the unknown.
  actorType: Schema.String,
  createdAt: Schema.String
})
export type AuditEvent = typeof AuditEvent.Type

export const AuditEventDetail = Schema.Struct({
  ...AuditEvent.fields,
  actorUserId: Schema.NullOr(Schema.String),
  metadata: AuditEventMetadata
})
export type AuditEventDetail = typeof AuditEventDetail.Type

/**
 * The keyset position every audit page cuts on — newest first on
 * `(createdAt, id)`, identical for both adapters.
 */
export function auditEventPosition(
  row: Pick<AuditEvent, 'createdAt' | 'id'>
): KeysetCursorPosition {
  return { key: row.createdAt, id: row.id }
}

/** Optional server-side filters and paging for the per-workspace read. */
export type ListAuditEventsInput = {
  /** Only events whose `actorUserId` matches. */
  readonly actorUserId?: string
  /** Only events of this event type (exact match). */
  readonly eventType?: string
  /** ISO timestamp lower bound, inclusive. */
  readonly since?: string
  /** ISO timestamp upper bound, inclusive. */
  readonly until?: string
  /**
   * Opaque keyset cursor from a previous page's `nextCursor`. An
   * undecodable cursor addresses no position and yields an empty page.
   * `| undefined` mirrors `ListPageInput` so the REST/MCP page input can be
   * passed through unchanged.
   */
  readonly cursor?: string | undefined
  /**
   * Page size, clamped to the shared list ceiling (200). Absent means the
   * audit page's own default below — the web app's audit trail keeps its
   * documented page size while the REST contract's `limit` reaches here
   * verbatim.
   */
  readonly limit?: number | undefined
}

/**
 * The per-workspace page size the audit read serves when the caller names
 * none: exactly 100 events, keyed on `(createdAt DESC, id DESC)`. The web
 * app's audit page rides this default; a caller-supplied `limit` (the REST
 * contract's query parameter) may narrow it but never exceeds the shared
 * list ceiling — see `internal/keyset-cursor.ts`.
 */
export const AUDIT_EVENT_PAGE_SIZE = 100

/**
 * Rows the Seed layer filters over. Enriches the wire shape with the storage
 * columns the wire deliberately hides (`workspaceId`, `actorUserId`), so Seed
 * can answer the same server-side filters as Live without reaching into D1.
 */
export type SeedAuditEventRow = AuditEvent & {
  readonly metadata?: JsonObject
  readonly actorType: AuditActorTypeValue
  readonly workspaceId?: string | null
  readonly actorUserId?: string | null
}

export type RecordAuditEventInput = {
  readonly workspaceId?: string | null
  readonly actorUserId?: string | null
  /**
   * Who the actor was: a session user, the platform, or a bearer API token.
   * Required invocation provenance, independent of the event's taxonomy.
   */
  readonly actorType: AuditActorTypeValue
  /**
   * From the taxonomy module — the write boundary is where the vocabulary is
   * enforced. The read path stays a lenient `Schema.String`.
   */
  readonly eventType: AuditEventType
  readonly targetType: AuditTargetType
  readonly targetId?: string | null
  /**
   * Per-event-type detail (token name + scopes, webhook url + events, delivery
   * attempts). Heterogeneous by design, but JSON — it is stored verbatim in the
   * `audit_events.metadata` JSON column.
   */
  readonly metadata?: JsonObject
}

/**
 * Reject missing or invalid provenance even for untyped callers. Event names
 * do not constrain who can perform an action.
 */
const decodeAuditActorType = Schema.decodeUnknownEffect(
  Schema.Literals(auditActorTypes)
)

export function assertAuditActorType(
  input: RecordAuditEventInput
): Effect.Effect<void> {
  // oxlint-disable-next-line no-restricted-properties -- missing internal invocation provenance is a caller defect, not a retryable store failure
  return decodeAuditActorType(input.actorType).pipe(Effect.orDie, Effect.asVoid)
}

export type AuditEventLogInterface = {
  readonly get: (
    id: string
  ) => Effect.Effect<AuditEventDetail | null, CapabilityUnavailable, WorkspaceContext>
  readonly list: (
    input?: ListAuditEventsInput
  ) => Effect.Effect<Page<AuditEvent>, CapabilityUnavailable, WorkspaceContext>
  readonly listGlobal: Effect.Effect<ReadonlyArray<AuditEvent>, CapabilityUnavailable>
  readonly record: (
    input: RecordAuditEventInput
  ) => Effect.Effect<void, CapabilityUnavailable>
  /**
   * Builds the audit insert statement (id + timestamp owned here) without
   * executing it, so mutating capabilities can run it atomically alongside
   * their own write via `batch` from `@b2b-saas-starter/db`. Effectful because
   * the id and `createdAt` are read from `Clock`, not from the ambient wall
   * clock — yield it, then pass the statement to `batch`.
   */
  readonly prepareRecord: (
    input: RecordAuditEventInput,
    condition?: SQL
  ) => Effect.Effect<BatchStatement>
}

export class AuditEventLog extends Context.Service<
  AuditEventLog,
  AuditEventLogInterface
>()('@b2b-saas-starter/capabilities/AuditEventLog') {}

/**
 * Records an event against the workspace in context, attributed to the actor
 * in context. The plugin-backed mutations (`WorkspaceMembership`,
 * `WorkspaceInvitations`, `WorkspaceLifecycle.rename`) all end the same way —
 * call the binding, read the row back, audit it — and this is that last step,
 * reading `workspaceId`, `actorUserId`, and the caller's actor type off
 * `WorkspaceContext` instead of having each call site restate them.
 *
 * The audit row is deliberately NOT atomic with the write it follows, and it
 * cannot be: D1 rejects an explicit BEGIN, and a plugin write that happens over
 * HTTP cannot join a `batch()`. A crash between the two leaves the mutation
 * without its audit row. Accepted and recorded (ADR 0051), not an oversight —
 * capabilities that write to D1 themselves use `auditedMutations`
 * (`audited-mutation.ts`), which commits both in one batch.
 */
export function recordInWorkspace(
  audit: AuditEventLogInterface,
  event: Omit<RecordAuditEventInput, 'workspaceId' | 'actorUserId' | 'actorType'>
): Effect.Effect<void, CapabilityUnavailable, WorkspaceContext> {
  return Effect.gen(function* () {
    const ctx = yield* WorkspaceContext
    yield* audit.record({
      ...event,
      workspaceId: ctx.workspace.id,
      actorUserId: ctx.actor?.userId ?? null,
      actorType: ctx.actorType
    })
  })
}

const noopStatement: BatchStatement = {
  toSQL: () => ({ sql: 'select 1', params: [] })
}

function toSeedWire(row: SeedAuditEventRow): AuditEvent {
  return {
    id: row.id,
    eventType: row.eventType,
    targetType: row.targetType,
    targetId: row.targetId ?? null,
    actor: row.actor,
    actorType: row.actorType,
    createdAt: row.createdAt
  }
}

function pagedSeedRows(
  rows: ReadonlyArray<SeedAuditEventRow>,
  workspaceId: string | undefined,
  input: ListAuditEventsInput | undefined
): Page<AuditEvent> {
  const matched = rows.filter(
    (row) =>
      (workspaceId === undefined || (row.workspaceId ?? null) === workspaceId) &&
      (input?.actorUserId === undefined ||
        (row.actorUserId ?? null) === input.actorUserId) &&
      (input?.eventType === undefined || row.eventType === input.eventType) &&
      (input?.since === undefined || row.createdAt >= input.since) &&
      (input?.until === undefined || row.createdAt <= input.until)
  )
  // The cursor decode (empty page on a malformed one), the `(createdAt DESC,
  // id DESC)` ordering, and the one-past-the-cap cut all come from the shared
  // keyset module — the same recipe Live applies in SQL. The wire projection
  // happens before the cut so both adapters page the same shape. The default
  // page names the audit read's own size (not the keyset module's generic
  // 50), so a walk that passes no limit pages identically against Live —
  // the export snapshot's completeness bound depends on it.
  return seedKeysetPage(matched.map(toSeedWire), 'desc', auditEventPosition, {
    ...input,
    limit: input?.limit ?? AUDIT_EVENT_PAGE_SIZE
  })
}

/**
 * The identities the Seed adapter resolves an actor's display name from — the
 * fixture's stand-in for the `user` rows Live joins.
 */
export type SeedAuditActor = {
  readonly id: string
  readonly name: string
}

/**
 * What the wire's `actor` slot holds: a display name. Live reads it off the
 * joined `user.name` and shows `system` for an unattributed row, so Seed must
 * answer with the fixture identity's name — never the raw user id, which would
 * put an internal id on a page that shows names under Live.
 */
function seedActorName(
  actors: ReadonlyArray<SeedAuditActor>,
  actorUserId: string | null | undefined
): string {
  if (!actorUserId) {
    return 'system'
  }
  return actors.find((actor) => actor.id === actorUserId)?.name ?? 'system'
}

export function SeedAuditEventLog(
  seed: ReadonlyArray<SeedAuditEventRow>,
  actors: ReadonlyArray<SeedAuditActor> = []
): Layer.Layer<AuditEventLog> {
  // A private copy: `record` appends without mutating the caller's fixture
  // array. Sharing state across adapters happens by providing one instance of
  // this layer (see layers.ts), not by sharing the fixture array.
  const rows: Array<SeedAuditEventRow> = structuredClone([...seed])
  return Layer.succeed(AuditEventLog)({
    get: Effect.fn('AuditEventLog.get')(function* (id: string) {
      const ctx = yield* WorkspaceContext
      const row = rows.find(
        (event) => event.id === id && event.workspaceId === ctx.workspace.id
      )
      if (!row) {
        return null
      }
      return {
        ...toSeedWire(row),
        actorUserId: row.actorUserId ?? null,
        metadata: decodeAuditEventMetadata(row.metadata ?? {})
      }
    }),
    // Same scoping as Live: the per-workspace read filters on the resolved
    // workspace from `WorkspaceContext` (invariant 1) — never an unscoped pass
    // over the fixture. Like the other Seed adapters, the context arrives
    // from the runner (selectWorkspaceLayer / testWorkspaceContext), not from
    // this layer.
    list: (input) =>
      Effect.gen(function* () {
        const ctx = yield* WorkspaceContext
        return pagedSeedRows(rows, ctx.workspace.id, input)
      }),
    listGlobal: Effect.sync(() => rows.map(toSeedWire)),
    record: (input) =>
      Effect.gen(function* () {
        yield* assertAuditActorType(input)
        // Appends into this instance's store so recorded events read back
        // through `list`/`listGlobal` exactly as Live's inserts do —
        // mutating-capability Seeds depend on this to satisfy the same
        // interface behavior.
        const row: SeedAuditEventRow = {
          id: yield* newCapabilityId('aud'),
          eventType: input.eventType,
          targetType: input.targetType,
          targetId: input.targetId ?? null,
          actor: seedActorName(actors, input.actorUserId),
          actorType: input.actorType,
          actorUserId: input.actorUserId ?? null,
          workspaceId: input.workspaceId ?? null,
          metadata: structuredClone(input.metadata ?? {}),
          createdAt: DateTime.formatIso(yield* DateTime.now)
        }
        rows.push(row)
      }),
    prepareRecord: (input) => assertAuditActorType(input).pipe(Effect.as(noopStatement))
  })
}
