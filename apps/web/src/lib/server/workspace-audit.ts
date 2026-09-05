import { type AuditEvent } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { type WorkspaceViewer } from '@/lib/permissions'
import { createServerFn } from '@tanstack/react-start'

import { expectOptionalString, expectRecord, expectString } from './input-shape'

/**
 * The audit-trail loader, in a **client-safe** module.
 *
 * This file is statically imported by the audit route (and its payload type
 * by the page and `lib/audit-search`), and the route tree ships to the
 * browser — so everything at this module's top level rides on every page.
 * That is why the payload assembly and its imports (the audit and
 * membership capabilities) live in `workspace-audit.effects.ts` and are
 * reached only through dynamic `import()` inside the handler: TanStack Start
 * strips handler bodies from the client build, so the capabilities graph
 * never ships, while the payload type still does.
 *
 * The behaviour is tested as the plain loader function in the effects file
 * (`workspace-audit.test.ts`), driven directly with fixture actors.
 */

/**
 * Server-side filters for the audit page, straight from the route's search
 * params. Dates arrive as `YYYY-MM-DD` and are widened to inclusive UTC
 * instant bounds in `loadWorkspaceAuditEvents` — the only place that knows
 * the wire contract is ISO timestamps (see `AuditEventLog.list`).
 */
export type WorkspaceAuditFilters = {
  actorUserId?: string
  eventType?: string
  since?: string
  until?: string
}

/** The loader's input shape. */
export type LoadWorkspaceAuditEventsInput = {
  workspaceSlug: string
  userId: string
  filters: WorkspaceAuditFilters
  /** Opaque keyset cursor from a previous page. */
  cursor?: string
}

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

/** Input shape of `loadWorkspaceAuditEventsServerFn`, for its client stub. */
type WorkspaceAuditInput = {
  readonly workspaceSlug: string
  readonly filters: WorkspaceAuditFilters
  readonly cursor?: string
}

/**
 * The server fn's validator, a plain shape check that runs on the server only
 * (TanStack strips `.validator()` from the client build): it is the server's
 * first decode, and the strict schema decodes again in
 * `workspace-audit.effects.ts`.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
function decodeFilters(value: unknown): WorkspaceAuditFilters {
  const record = expectRecord(value, 'audit input: filters')
  const filters: WorkspaceAuditFilters = {}
  const actorUserId = expectOptionalString(
    record,
    'actorUserId',
    'audit input: filters'
  )
  if (actorUserId !== undefined) {
    filters.actorUserId = actorUserId
  }
  const eventType = expectOptionalString(record, 'eventType', 'audit input: filters')
  if (eventType !== undefined) {
    filters.eventType = eventType
  }
  const since = expectOptionalString(record, 'since', 'audit input: filters')
  if (since !== undefined) {
    filters.since = since
  }
  const until = expectOptionalString(record, 'until', 'audit input: filters')
  if (until !== undefined) {
    filters.until = until
  }
  return filters
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
function decodeAuditInput(input: unknown): WorkspaceAuditInput {
  const record = expectRecord(input, 'audit input')
  const cursor = expectOptionalString(record, 'cursor', 'audit input')
  return {
    workspaceSlug: expectString(record, 'workspaceSlug', 'audit input'),
    filters: decodeFilters(record['filters']),
    ...(cursor !== undefined && { cursor })
  }
}

/** The audit route's loader. */
export const loadWorkspaceAuditEventsServerFn = createServerFn({
  method: 'GET'
})
  .validator(decodeAuditInput)
  .handler(async ({ data }): Promise<WorkspaceAuditPayload> => {
    const { loadWorkspaceAuditEventsHandler } =
      await import('./workspace-audit.effects')
    return loadWorkspaceAuditEventsHandler(data)
  })
