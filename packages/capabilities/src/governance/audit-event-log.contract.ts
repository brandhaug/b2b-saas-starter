import { Effect, Encoding } from 'effect'
import { type ContractExpectMatchers } from './contract-expect.ts'
import { type CapabilityUnavailable } from '../errors.ts'
import {
  AuditEventLog,
  type AuditEventPage,
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

/** The slice of vitest's `expect` these cases use — see the lifecycle contract. */
export type ContractExpect = <A>(
  actual: A
) => Pick<ContractExpectMatchers<A>, 'toBe' | 'toEqual' | 'toHaveLength'>

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
    AuditEventPage,
    CapabilityUnavailable,
    AuditEventLog | WorkspaceContext
  >,
  expect: ContractExpect
): ReadonlyArray<AuditEventLogContractCase> {
  return [
    {
      name: 'lists events most-recent-first with ties broken by id',
      assert: Effect.gen(function* () {
        const page = yield* list()
        expect(page.events.map((event) => event.id)).toEqual([
          'aud_c_tie_b',
          'aud_c_tie_a',
          'aud_c_old'
        ])
        // A short page is the last page.
        expect(page.nextCursor).toBe(null)
      })
    },
    {
      name: 'exposes targetId on the wire',
      assert: Effect.gen(function* () {
        const page = yield* list({ eventType: 'webhook_endpoint.created' })
        expect(page.events.map((event) => event.targetId)).toEqual(['wh_a'])
      })
    },
    {
      name: 'filters by actor server-side',
      assert: Effect.gen(function* () {
        const page = yield* list({ actorUserId: 'usr_bob' })
        expect(page.events.map((event) => event.id)).toEqual(['aud_c_tie_b'])
      })
    },
    {
      name: 'filters by date range inclusive of both bounds',
      assert: Effect.gen(function* () {
        const page = yield* list({
          since: '2026-06-01T10:00:00.000Z',
          until: '2026-06-02T10:00:00.000Z'
        })
        expect(page.events).toHaveLength(3)
        const narrowed = yield* list({
          since: '2026-06-01T10:00:00.001Z'
        })
        expect(narrowed.events.map((event) => event.id)).toEqual([
          'aud_c_tie_b',
          'aud_c_tie_a'
        ])
      })
    },
    {
      name: 'yields an empty page for an undecodable cursor',
      assert: Effect.gen(function* () {
        const page = yield* list({ cursor: 'not-a-cursor' })
        expect(page.events).toHaveLength(0)
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
        expect(page.events.map((event) => event.id)).toEqual([
          'aud_c_tie_a',
          'aud_c_old'
        ])
      })
    },
    {
      name: 'limit narrows the page below the default cap',
      assert: Effect.gen(function* () {
        const page = yield* list({ limit: 2 })
        expect(page.events.map((event) => event.id)).toEqual([
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
        expect(first.events.map((event) => event.id)).toEqual(['aud_c_tie_b'])
        // An event recorded between the two fetches lands wherever its
        // clock puts it — but the resumed page's keyset window is frozen
        // exactly where the first page ended: the original rows it covers
        // appear unchanged, and nothing is duplicated.
        yield* audit.record({
          workspaceId: ctx.workspace.id,
          actorUserId: 'usr_alice',
          eventType: 'api_token.created',
          targetType: 'api_token',
          targetId: 'tok_inserted'
        })
        const second = yield* list({
          limit: 5,
          cursor: first.nextCursor ?? undefined
        })
        const secondOriginals: Array<string> = []
        for (const event of second.events) {
          if (event.id.startsWith('aud_c_')) {
            secondOriginals.push(event.id)
          }
        }
        expect(secondOriginals).toEqual(['aud_c_tie_a', 'aud_c_old'])
        // A fresh walk serves every event exactly once, and the original
        // three keep their relative order wherever the new one landed.
        const fresh = yield* list({ limit: 10 })
        const originalIds: Array<string> = []
        for (const event of fresh.events) {
          if (event.id.startsWith('aud_c_')) {
            originalIds.push(event.id)
          }
        }
        expect(fresh.events).toHaveLength(4)
        expect(originalIds).toEqual(['aud_c_tie_b', 'aud_c_tie_a', 'aud_c_old'])
      })
    }
  ]
}
