import { type AuditEvent } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { type WorkspaceViewer } from '@/lib/permissions'
import { createServerFn } from '@tanstack/react-start'
import { Schema, type Types } from 'effect'

/**
 * The audit-trail loader, in a **client-safe** module — the client-safe half
 * of the `workspace-audit.effects.ts` split (see apps/web/AGENTS.md for the
 * rule and `assert-client-boundary.mjs` for the enforcement). Each input is
 * written once, as its Effect Schema: the validator is the single strict
 * decode, and the derived types below type both the client stub and the
 * effects handler.
 *
 * The behaviour is tested as the plain loader function in the effects file
 * (`workspace-audit.test.ts`), driven directly with fixture actors.
 */

/**
 * Server-side filters for the audit page, straight from the route's search
 * params. Dates arrive as `YYYY-MM-DD` and are widened to inclusive UTC
 * instant bounds in `loadWorkspaceAuditEvents` — the only place that knows
 * the wire contract is ISO timestamps (see `AuditEventLog.list`). Widened
 * mutable because the route stages a filter onto an empty record key by key.
 */
const WorkspaceAuditFilters = Schema.Struct({
  actorUserId: Schema.optionalKey(Schema.String),
  eventType: Schema.optionalKey(Schema.String),
  since: Schema.optionalKey(Schema.String),
  until: Schema.optionalKey(Schema.String)
})

export type WorkspaceAuditFilters = Types.Mutable<typeof WorkspaceAuditFilters.Type>

/**
 * The per-workspace audit payload. `auditLog: ['read']` is the page's own read
 * permission and a hard gate — the whole page is the audit log, so an actor
 * without it has no page to render (403), not an empty shell. That is also why
 * this payload is permission-shaped by construction rather than by nullable
 * segments: nothing below the gate needs a second decision.
 *
 * The member list feeds the actor filter's id-keyed options. No second
 * permission decision is made here: `auditLog: ['read']` is owner/admin only,
 * and the hard gate above already decided who reaches this payload.
 */
export type WorkspaceAuditPayload = {
  readonly viewer: WorkspaceViewer | null
  readonly events: ReadonlyArray<AuditEvent>
  /** Opaque keyset cursor for the next older page, or null on the last one. */
  readonly nextCursor: string | null
  /** The filters this page was loaded with, echoed back for the controls. */
  readonly filters: WorkspaceAuditFilters
  readonly members: ReadonlyArray<{ readonly id: string; readonly name: string }>
}

/**
 * The server fn's input. The filter keys stay optional and unconstrained —
 * the page's search params are lenient on purpose, and an unknown event type
 * or an undecodable cursor addresses an empty result, not an error.
 */
const WorkspaceAuditInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  filters: WorkspaceAuditFilters,
  cursor: Schema.optionalKey(Schema.String)
})

export type WorkspaceAuditInput = typeof WorkspaceAuditInput.Type

/**
 * The loader's input: the fn's decoded input plus the acting member —
 * `userId` never rides the wire, so the handler adds it from the session.
 * Widened mutable because tests stage a cursor onto the built input
 * (`workspace-audit.test.ts`).
 */
export type LoadWorkspaceAuditEventsInput = Types.Mutable<
  typeof WorkspaceAuditInput.Type
> & {
  userId: string
}

/** The audit route's loader. */
export const loadWorkspaceAuditEventsServerFn = createServerFn({
  method: 'GET'
})
  .validator(Schema.decodeUnknownSync(WorkspaceAuditInput))
  .handler(async ({ data }): Promise<WorkspaceAuditPayload> => {
    const { loadWorkspaceAuditEventsHandler } =
      await import('./workspace-audit.effects')
    return loadWorkspaceAuditEventsHandler(data)
  })
