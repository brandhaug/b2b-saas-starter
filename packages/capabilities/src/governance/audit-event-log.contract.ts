import { Effect, Encoding } from 'effect'
import { type ContractExpect } from './contract-expect.ts'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type Page } from '../internal/keyset-cursor.ts'
import {
  AUDIT_EVENT_PAGE_SIZE,
  AuditEventLog,
  type AuditEvent,
  type ListAuditEventsInput,
  type SeedAuditEventRow
} from './audit-event-log.ts'
import { WorkspaceContext } from '../workspace-context.ts'

/**
 * The read contract, written once and run against both adapters — capabilities
 * invariant 4, the same shape as the membership / invitation / lifecycle
 * contracts.
 *
 * The cases run over a dataset both adapters install identically (see
 * `auditEventContractDataset`): three rows in one workspace, two actors, two
 * event types, staggered timestamps with one tie broken by id. Full-page
 * keyset pagination needs more rows than the fixed 100 cap, so it cannot be a
 * shared case — each adapter's test file covers it against its own data.
 */

export type AuditEventLogContractCase = {
  readonly name: string
  readonly assert: Effect.Effect<
    void,
    CapabilityUnavailable,
    AuditEventLog | WorkspaceContext
  >
}

/**
 * The dataset every adapter installs before running the cases, all attributed
 * to one workspace so adapters can scope `list` to it.
 */
export function auditEventContractDataset(
  workspaceId: string
): ReadonlyArray<SeedAuditEventRow> {
  return [
    {
      id: 'aud_c_old',
      workspaceId,
      actorUserId: 'usr_alice',
      actorType: 'user',
      eventType: 'api_token.created',
      targetType: 'api_token',
      targetId: 'tok_a',
      actor: 'Alice',
      createdAt: '2026-06-01T10:00:00.000Z'
    },
    {
      // Same instant as the row below — ordering between them is decided by id.
      id: 'aud_c_tie_b',
      workspaceId,
      actorUserId: 'usr_bob',
      actorType: 'user',
      eventType: 'api_token.created',
      targetType: 'api_token',
      targetId: null,
      actor: 'Bob',
      createdAt: '2026-06-02T10:00:00.000Z'
    },
    {
      id: 'aud_c_tie_a',
      workspaceId,
      actorUserId: 'usr_alice',
      actorType: 'user',
      eventType: 'webhook_endpoint.created',
      targetType: 'webhook_endpoint',
      targetId: 'wh_a',
      actor: 'Alice',
      createdAt: '2026-06-02T10:00:00.000Z'
    }
  ]
}

export function auditEventLogContractCases(
  list: (
    input?: ListAuditEventsInput
  ) => Effect.Effect<
    Page<AuditEvent>,
    CapabilityUnavailable,
    AuditEventLog | WorkspaceContext
  >,
  expect: ContractExpect
): ReadonlyArray<AuditEventLogContractCase> {
  return [
    {
      name: 'gets an event independently of list filters and cursors',
      assert: Effect.gen(function* () {
        const audit = yield* AuditEventLog
        expect(
          (yield* list({ eventType: 'no.such.event', cursor: 'invalid' })).items
        ).toEqual([])
        const event = yield* audit.get('aud_c_old')
        expect(event?.id).toBe('aud_c_old')
        expect(event?.actorUserId).toBe('usr_alice')
        expect(event?.actor).toBe('Alice')
        expect(event?.targetId).toBe('tok_a')
        expect(yield* audit.get('missing')).toBe(null)
      })
    },
    {
      name: 'lists events most-recent-first with ties broken by id',
      assert: Effect.gen(function* () {
        const page = yield* list()
        expect(page.items.map((event) => event.id)).toEqual([
          'aud_c_tie_b',
          'aud_c_tie_a',
          'aud_c_old'
        ])
        // A short page is the last page.
        expect(page.nextCursor).toBe(null)
      })
    },
    {
      // `listGlobal` is unpaged, so its order and its cap are the whole
      // answer: a Seed adapter that returned insertion order (or every row it
      // held) would drift from Live's `ORDER BY createdAt DESC, id DESC LIMIT
      // 100` without any membership assertion noticing.
      name: 'lists every workspace newest-first, capped at one page',
      assert: Effect.gen(function* () {
        const audit = yield* AuditEventLog
        const events = yield* audit.listGlobal
        // Capped at one page: nothing may sit past the cap.
        expect(events.slice(AUDIT_EVENT_PAGE_SIZE).map((event) => event.id)).toEqual([])
        // The whole list runs newest-first on `(createdAt, id)` — no pair may
        // step forwards.
        const outOfOrder = events.filter((event, index) => {
          const previous = events[index - 1]
          if (previous === undefined) {
            return false
          }
          if (previous.createdAt !== event.createdAt) {
            return previous.createdAt < event.createdAt
          }
          return previous.id < event.id
        })
        expect(outOfOrder.map((event) => event.id)).toEqual([])
        // And the fixture rows come back in that exact sequence, tie included.
        const fixtureIds: Array<string> = []
        for (const event of events) {
          if (event.id.startsWith('aud_c_')) {
            fixtureIds.push(event.id)
          }
        }
        expect(fixtureIds).toEqual(['aud_c_tie_b', 'aud_c_tie_a', 'aud_c_old'])
      })
    },
    {
      name: 'exposes targetId on the wire',
      assert: Effect.gen(function* () {
        const page = yield* list({ eventType: 'webhook_endpoint.created' })
        expect(page.items.map((event) => event.targetId)).toEqual(['wh_a'])
      })
    },
    {
      name: 'filters by actor server-side',
      assert: Effect.gen(function* () {
        const page = yield* list({ actorUserId: 'usr_bob' })
        expect(page.items.map((event) => event.id)).toEqual(['aud_c_tie_b'])
      })
    },
    {
      name: 'filters by date range inclusive of both bounds',
      assert: Effect.gen(function* () {
        const page = yield* list({
          since: '2026-06-01T10:00:00.000Z',
          until: '2026-06-02T10:00:00.000Z'
        })
        expect(page.items).toHaveLength(3)
        const narrowed = yield* list({
          since: '2026-06-01T10:00:00.001Z'
        })
        expect(narrowed.items.map((event) => event.id)).toEqual([
          'aud_c_tie_b',
          'aud_c_tie_a'
        ])
      })
    },
    {
      name: 'yields an empty page for an undecodable cursor',
      assert: Effect.gen(function* () {
        const page = yield* list({ cursor: 'not-a-cursor' })
        expect(page.items).toHaveLength(0)
        expect(page.nextCursor).toBe(null)
      })
    },
    {
      name: 'resumes strictly after a cursor position',
      assert: Effect.gen(function* () {
        // Cursor for the middle row (tie loser): everything strictly before
        // it in (createdAt DESC, id DESC) order — its tie twin first, then the
        // oldest row.
        const page = yield* list({
          cursor: Encoding.encodeBase64('2026-06-02T10:00:00.000Z aud_c_tie_b')
        })
        expect(page.items.map((event) => event.id)).toEqual([
          'aud_c_tie_a',
          'aud_c_old'
        ])
      })
    },
    {
      name: 'limit narrows the page below the default cap',
      assert: Effect.gen(function* () {
        const page = yield* list({ limit: 2 })
        expect(page.items.map((event) => event.id)).toEqual([
          'aud_c_tie_b',
          'aud_c_tie_a'
        ])
        expect(page.nextCursor !== null).toBe(true)
      })
    },
    {
      // Last: it records an event into the shared dataset, so every case
      // after it would see a fourth row.
      name: 'an insert between page fetches does not shift the unseen window',
      assert: Effect.gen(function* () {
        const audit = yield* AuditEventLog
        const ctx = yield* WorkspaceContext
        const first = yield* list({ limit: 1 })
        expect(first.items.map((event) => event.id)).toEqual(['aud_c_tie_b'])
        // An event recorded between the two fetches lands wherever its
        // clock puts it — but the resumed page's keyset window is frozen
        // exactly where the first page ended: the original rows it covers
        // appear unchanged, and nothing is duplicated.
        yield* audit.record({
          workspaceId: ctx.workspace.id,
          actorUserId: 'usr_alice',
          actorType: 'user',
          eventType: 'api_token.created',
          targetType: 'api_token',
          targetId: 'tok_inserted'
        })
        const second = yield* list({
          limit: 5,
          cursor: first.nextCursor ?? undefined
        })
        const secondOriginals: Array<string> = []
        for (const event of second.items) {
          if (event.id.startsWith('aud_c_')) {
            secondOriginals.push(event.id)
          }
        }
        expect(secondOriginals).toEqual(['aud_c_tie_a', 'aud_c_old'])
        // A fresh walk serves every event exactly once, and the original
        // three keep their relative order wherever the new one landed.
        const fresh = yield* list({ limit: 10 })
        const originalIds: Array<string> = []
        for (const event of fresh.items) {
          if (event.id.startsWith('aud_c_')) {
            originalIds.push(event.id)
          }
        }
        expect(fresh.items).toHaveLength(4)
        expect(originalIds).toEqual(['aud_c_tie_b', 'aud_c_tie_a', 'aud_c_old'])
      })
    },
    {
      // Records into the shared dataset; keep after pagination assertions.
      name: 'exposes the recorded actor type on the wire',
      assert: Effect.gen(function* () {
        const audit = yield* AuditEventLog
        const ctx = yield* WorkspaceContext
        yield* audit.record({
          workspaceId: ctx.workspace.id,
          actorUserId: null,
          actorType: 'api_token',
          eventType: 'api_token.created',
          targetType: 'api_token',
          targetId: 'tok_rest'
        })
        // The same operation can run as a system job.
        yield* audit.record({
          workspaceId: ctx.workspace.id,
          actorUserId: null,
          actorType: 'system',
          eventType: 'api_token.created',
          targetType: 'api_token',
          targetId: 'tok_system'
        })
        const page = yield* list({ limit: 10 })
        const byTarget = new Map(
          page.items.map((event) => [event.targetId ?? '', event])
        )
        expect(byTarget.get('tok_rest')?.actorType).toBe('api_token')
        expect(byTarget.get('tok_rest')?.actor).toBe('system')
        expect(byTarget.get('tok_system')?.actorType).toBe('system')
        expect(byTarget.get('tok_a')?.actorType).toBe('user')
      })
    },
    {
      name: 'does not infer provenance from event taxonomy or user attribution',
      assert: Effect.gen(function* () {
        const audit = yield* AuditEventLog
        const ctx = yield* WorkspaceContext
        yield* audit.record({
          workspaceId: ctx.workspace.id,
          actorType: 'system',
          eventType: 'workspace.created',
          targetType: 'workspace',
          targetId: 'automated_workspace',
          metadata: {
            role: 'admin',
            attempts: 2,
            responseStatus: 503,
            email: 'private@example.com',
            scopes: ['admin'],
            url: 'https://secret.example',
            nested: { token: 'secret' }
          }
        })
        yield* audit.record({
          workspaceId: ctx.workspace.id,
          actorUserId: null,
          actorType: 'user',
          eventType: 'workspace.created',
          targetType: 'workspace',
          targetId: 'interactive_workspace'
        })
        const page = yield* list({ eventType: 'workspace.created' })
        const recorded = page.items.find(
          (event) => event.targetId === 'automated_workspace'
        )
        const detail = yield* audit.get(recorded?.id ?? '')
        expect(detail?.metadata).toEqual({
          role: 'admin',
          attempts: 2,
          responseStatus: 503
        })
        const ctxOther = {
          ...ctx,
          workspace: { ...ctx.workspace, id: 'other-workspace' }
        }
        expect(
          yield* audit
            .get(recorded?.id ?? '')
            .pipe(Effect.provideService(WorkspaceContext, ctxOther))
        ).toBe(null)
        expect('metadata' in (recorded ?? {})).toBe(false)
        const globalEvent = (yield* audit.listGlobal).find(
          (event) => event.id === recorded?.id
        )
        expect(globalEvent?.id).toBe(recorded?.id)
        expect('metadata' in (globalEvent ?? {})).toBe(false)
        expect(
          page.items.find((event) => event.targetId === 'automated_workspace')
            ?.actorType
        ).toBe('system')
        expect(
          page.items.find((event) => event.targetId === 'interactive_workspace')
            ?.actorType
        ).toBe('user')
      })
    },
    {
      name: 'snapshots recorded metadata so callers cannot rewrite an audit event',
      assert: Effect.gen(function* () {
        const audit = yield* AuditEventLog
        const ctx = yield* WorkspaceContext
        const metadata = { attempts: 2 }
        yield* audit.record({
          workspaceId: ctx.workspace.id,
          actorType: 'system',
          eventType: 'webhook.delivery_failed',
          targetType: 'webhook_endpoint',
          targetId: 'metadata-snapshot',
          metadata
        })
        metadata.attempts = 99
        const page = yield* audit.list({ eventType: 'webhook.delivery_failed' })
        const recorded = page.items.find(
          (event) => event.targetId === 'metadata-snapshot'
        )
        expect((yield* audit.get(recorded?.id ?? ''))?.metadata).toEqual({
          attempts: 2
        })
      })
    }
  ]
}
