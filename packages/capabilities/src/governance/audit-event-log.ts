import { type JsonObject } from '@b2b-saas-starter/db/schema'
import { type BatchStatement } from '@b2b-saas-starter/db/service'
import { Context, DateTime, Effect, Layer, Schema } from 'effect'

import { type CapabilityUnavailable } from '../errors.ts'
import { seedKeysetPage, type KeysetCursorPosition } from '../internal/keyset-cursor.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { type AuditEventType, type AuditTargetType } from './audit-event-taxonomy.ts'
import { WorkspaceContext } from '../workspace-context.ts'

export const AuditEvent = Schema.Struct({
  id: Schema.String,
  eventType: Schema.String,
  targetType: Schema.String,
  targetId: Schema.NullOr(Schema.String),
  actor: Schema.String,
  createdAt: Schema.String
})
export type AuditEvent = typeof AuditEvent.Type

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

export type AuditEventPage = {
  readonly events: ReadonlyArray<AuditEvent>
  /** Cursor for the next older page, or null when this page is the last. */
  readonly nextCursor: string | null
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
  readonly workspaceId?: string | null
  readonly actorUserId?: string | null
}

export type RecordAuditEventInput = {
  readonly workspaceId?: string | null
  readonly actorUserId?: string | null
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

export type AuditEventLogInterface = {
  readonly list: (
    input?: ListAuditEventsInput
  ) => Effect.Effect<AuditEventPage, CapabilityUnavailable, WorkspaceContext>
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
    input: RecordAuditEventInput
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
 * reading `workspaceId` and `actorUserId` off `WorkspaceContext` instead of
 * having each call site restate them.
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
  event: Omit<RecordAuditEventInput, 'workspaceId' | 'actorUserId'>
): Effect.Effect<void, CapabilityUnavailable, WorkspaceContext> {
  return Effect.gen(function* () {
    const ctx = yield* WorkspaceContext
    yield* audit.record({
      ...event,
      workspaceId: ctx.workspace.id,
      actorUserId: ctx.actor?.userId ?? null
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
    createdAt: row.createdAt
  }
}

function pagedSeedRows(
  rows: ReadonlyArray<SeedAuditEventRow>,
  workspaceId: string | undefined,
  input: ListAuditEventsInput | undefined
): AuditEventPage {
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
  // keyset module — the same recipe Live applies in SQL.
  const page = seedKeysetPage(matched, 'desc', auditEventPosition, input)
  return { events: page.items.map(toSeedWire), nextCursor: page.nextCursor }
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
  const rows: Array<SeedAuditEventRow> = [...seed]
  return Layer.succeed(AuditEventLog)({
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
          actorUserId: input.actorUserId ?? null,
          workspaceId: input.workspaceId ?? null,
          createdAt: DateTime.formatIso(yield* DateTime.now)
        }
        rows.push(row)
      }),
    prepareRecord: () => Effect.succeed(noopStatement)
  })
}
