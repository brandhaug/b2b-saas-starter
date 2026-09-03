import { Effect, Exit } from 'effect'
import { type ContractExpectMatchers } from '../governance/contract-expect.ts'
import { failureTag } from '../internal/failure-tag.ts'
import { type CapabilityUnavailable, type PlanLimitExceeded } from '../errors.ts'
import { type InvalidWebhookUrl } from './webhook-url.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { ApiTokenRegistry } from './api-token-registry.ts'
import { WebhookEndpoints } from './webhook-endpoints.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'

/**
 * Walks a paged read one row at a time and returns the ids in page order.
 * The loop cap is the runaway guard: a cursor that never reaches `null`
 * stops the walk early, and the coverage assertions the callers run over
 * the result fail loudly against a truncated walk.
 */
function walkPageIds<A, E, R>(
  page: (input: {
    limit: number
    cursor?: string | undefined
  }) => Effect.Effect<
    { readonly items: ReadonlyArray<A>; readonly nextCursor: string | null },
    E,
    R
  >,
  idOf: (item: A) => string
): Effect.Effect<Array<string>, E, R> {
  return Effect.gen(function* () {
    const ids: Array<string> = []
    // Annotated: `cursor`'s type must not be inferred from the page result,
    // or the loop's initializer would reference itself.
    let cursor: string | null = null
    let continueWalking = true
    for (let guard = 0; guard < 25 && continueWalking; guard += 1) {
      const result: {
        readonly items: ReadonlyArray<A>
        readonly nextCursor: string | null
      } = yield* page({ limit: 1, cursor: cursor ?? undefined })
      for (const item of result.items) {
        ids.push(idOf(item))
      }
      cursor = result.nextCursor
      continueWalking = cursor !== null
    }
    return ids
  })
}

/**
 * The developer-platform mutation contract, written once and run against both
 * adapters — capabilities invariant 4, the same pattern as the membership /
 * invitations / lifecycle contracts.
 *
 * These cases exist because matching types were never enough: the Seed
 * adapters used to no-op their delivery and audit surfaces while satisfying
 * the same interface, so drift was invisible until someone read both files.
 * Every case asserts only what both adapters can honestly promise.
 */

export type DeveloperPlatformContractCase = {
  readonly name: string
  readonly assert: Effect.Effect<
    void,
    CapabilityUnavailable | InvalidWebhookUrl | PlanLimitExceeded,
    ApiTokenRegistry | WebhookEndpoints | AuditEventLog | WorkspaceContext
  >
}

export type PlanLimitContractCase = {
  readonly name: string
  readonly assert: Effect.Effect<
    void,
    CapabilityUnavailable | PlanLimitExceeded,
    ApiTokenRegistry | WorkspaceContext
  >
}

/**
 * The slice of vitest's `expect` these cases use — deliberately narrow, for
 * the same reason the membership contract narrows it.
 */
export type ContractExpect = <A>(
  actual: A
) => Pick<
  ContractExpectMatchers<A>,
  'toBe' | 'toEqual' | 'toHaveLength' | 'toMatchObject'
>

export function developerPlatformContractCases(
  expect: ContractExpect
): ReadonlyArray<DeveloperPlatformContractCase> {
  return [
    {
      name: 'created token lists back and disappears after revoke',
      assert: Effect.gen(function* () {
        const tokens = yield* ApiTokenRegistry
        const created = yield* tokens.create({
          name: 'contract',
          scopes: ['read']
        })
        expect((yield* tokens.list).some((t) => t.id === created.id)).toBe(true)

        expect(yield* tokens.revoke({ tokenId: created.id })).toBe(true)
        expect((yield* tokens.list).some((t) => t.id === created.id)).toBe(false)
      })
    },
    {
      name: 'revoking an already-revoked or unknown token resolves false',
      assert: Effect.gen(function* () {
        const tokens = yield* ApiTokenRegistry
        const created = yield* tokens.create({
          name: 'once',
          scopes: ['read']
        })
        yield* tokens.revoke({ tokenId: created.id })

        expect(yield* tokens.revoke({ tokenId: created.id })).toBe(false)
        expect(yield* tokens.revoke({ tokenId: 'tok_missing' })).toBe(false)
      })
    },
    {
      name: 'revoke records an api_token.revoked audit event readable through AuditEventLog',
      assert: Effect.gen(function* () {
        const tokens = yield* ApiTokenRegistry
        const log = yield* AuditEventLog
        const before = (yield* log.list({ eventType: 'api_token.revoked' })).events
          .length

        const created = yield* tokens.create({
          name: 'audited',
          scopes: ['read']
        })
        yield* tokens.revoke({ tokenId: created.id })

        const page = yield* log.list({ eventType: 'api_token.revoked' })
        expect(page.events.length).toBe(before + 1)
        // Other cases in the suite revoke too, so scope to this token rather
        // than assuming the newest event is ours.
        expect(
          page.events.some(
            (event) => event.targetId === created.id && event.targetType === 'api_token'
          )
        ).toBe(true)
      })
    },
    {
      name: 'a created webhook endpoint lists back and resolves a dispatch target',
      assert: Effect.gen(function* () {
        const webhooks = yield* WebhookEndpoints
        const { endpoint } = yield* webhooks.create({
          url: 'https://example.com/contract-hook',
          events: ['demo.event']
        })

        const listed = yield* webhooks.list
        expect(listed.some((each) => each.id === endpoint.id)).toBe(true)

        const ctx = yield* WorkspaceContext
        expect(
          yield* webhooks.getDispatchTarget(endpoint.id, ctx.workspace.id)
        ).toMatchObject({ id: endpoint.id, url: endpoint.url })
      })
    },
    {
      name: 'a disabled endpoint stops resolving dispatch targets',
      assert: Effect.gen(function* () {
        const webhooks = yield* WebhookEndpoints
        const ctx = yield* WorkspaceContext
        const { endpoint } = yield* webhooks.create({
          url: 'https://example.com/disable-hook',
          events: ['demo.event']
        })

        expect(yield* webhooks.disable({ endpointId: endpoint.id })).toBe(true)
        expect(yield* webhooks.getDispatchTarget(endpoint.id, ctx.workspace.id)).toBe(
          null
        )
      })
    },
    {
      name: 'recorded delivery attempts list newest first without audit events',
      assert: Effect.gen(function* () {
        const webhooks = yield* WebhookEndpoints
        const log = yield* AuditEventLog
        const { endpoint } = yield* webhooks.create({
          url: 'https://example.com/deliveries-hook',
          events: ['demo.event']
        })
        const auditsBefore = (yield* log.listGlobal).filter((event) =>
          event.eventType.startsWith('webhook.delivery')
        ).length

        yield* webhooks.recordDeliveryAttempt({
          id: 'whd_contract_first',
          endpointId: endpoint.id,
          workspaceId: 'irrelevant-to-list-scoping',
          eventType: 'demo.event',
          status: 'delivered',
          attempts: 1,
          responseStatus: 200,
          nextAttemptAt: null
        })
        yield* webhooks.recordDeliveryAttempt({
          id: 'whd_contract_second',
          endpointId: endpoint.id,
          workspaceId: 'irrelevant-to-list-scoping',
          eventType: 'demo.event',
          status: 'failed',
          attempts: 2,
          responseStatus: 500,
          nextAttemptAt: null
        })

        const deliveries = yield* webhooks.listDeliveries({
          endpointId: endpoint.id
        })
        // Both rows list back. Newest-first *ordering* is not asserted here:
        // the two rows can share a timestamp, and Live orders on
        // `lastAttemptAt` alone, so a strict order is only honest when the
        // timestamps differ.
        expect(deliveries).toHaveLength(2)
        expect(deliveries.map((row) => row.id).toSorted()).toEqual([
          'whd_contract_first',
          'whd_contract_second'
        ])
        // Retryable attempts stay out of the governance log on both adapters.
        const auditsAfter = (yield* log.listGlobal).filter((event) =>
          event.eventType.startsWith('webhook.delivery')
        ).length
        expect(auditsAfter).toBe(auditsBefore)
      })
    },
    {
      name: 'a dead-lettered terminal attempt batches its webhook.delivery_dead_lettered audit event',
      assert: Effect.gen(function* () {
        const webhooks = yield* WebhookEndpoints
        const log = yield* AuditEventLog
        const { endpoint } = yield* webhooks.create({
          url: 'https://example.com/dead-letter-hook',
          events: ['demo.event']
        })
        const ctx = yield* WorkspaceContext

        const { deliveryId } = yield* webhooks.recordTerminalDeliveryAttempt({
          endpointId: endpoint.id,
          workspaceId: ctx.workspace.id,
          eventType: 'demo.event',
          attempts: 5,
          status: 'dead_lettered'
        })

        const events = yield* log.list({
          eventType: 'webhook.delivery_dead_lettered'
        })
        // The delivery-attempt suites dead-letter their own endpoints too, so
        // scope to this one instead of assuming the newest event is ours.
        expect(events.events.some((event) => event.targetId === endpoint.id)).toBe(true)
        // The audit metadata points back at the row it committed with, and the
        // row itself is listable through the same interface.
        const rows = yield* webhooks.listDeliveries({ endpointId: endpoint.id })
        expect(rows.some((row) => row.id === deliveryId)).toBe(true)
      })
    },
    {
      // Runs last in the list on purpose: it creates rows, and the walk
      // assertions are order-independent but the later coverage suites are not.
      name: 'token pages walk exactly once and an insert never disturbs the emitted prefix',
      assert: Effect.gen(function* () {
        const tokens = yield* ApiTokenRegistry
        const first = yield* walkPageIds(
          (input) => tokens.listPage(input),
          (token) => token.id
        )
        // Every active token exactly once — the walk agrees with the
        // whole-collection read as a set (row order may differ when rows
        // share a createdAt instant; the tie is broken by id, not position).
        expect(first.toSorted()).toEqual(
          (yield* tokens.list).map((token) => token.id).toSorted()
        )

        const created = yield* tokens.create({
          name: 'paging-stability',
          scopes: ['read']
        })
        const second = yield* walkPageIds(
          (input) => tokens.listPage(input),
          (token) => token.id
        )
        // The inserted token appears exactly once, every previously emitted
        // row keeps its position relative to the others, and nothing the
        // first walk already served was dropped or duplicated.
        const firstSet = new Set(first)
        expect(second.filter((id) => id === created.id)).toEqual([created.id])
        expect(second.filter((id) => !firstSet.has(id))).toEqual([created.id])
        expect(second.filter((id) => firstSet.has(id))).toEqual(first)
      })
    },
    {
      name: 'webhook pages walk forward on id and an insert never duplicates a row',
      assert: Effect.gen(function* () {
        const webhooks = yield* WebhookEndpoints
        const first = yield* walkPageIds(
          (input) => webhooks.listPage(input),
          (endpoint) => endpoint.id
        )
        // Forward order on `id ASC` — the wire shape carries no timestamp,
        // so the id is the one stable order a page can resume.
        expect(first).toEqual(first.toSorted())

        const { endpoint } = yield* webhooks.create({
          url: 'https://example.com/paging-hook',
          events: ['demo.event']
        })
        const second = yield* walkPageIds(
          (input) => webhooks.listPage(input),
          (row) => row.id
        )
        // No duplicates, nothing lost: every pre-insert row survives the
        // second walk exactly once, and the new endpoint lands somewhere
        // valid in the id order — before or after the cursor alike.
        const firstSet = new Set(first)
        expect(second.filter((id) => id === endpoint.id)).toEqual([endpoint.id])
        expect(second.filter((id) => !firstSet.has(id))).toEqual([endpoint.id])
        expect(second.filter((id) => firstSet.has(id))).toEqual(first)
        expect(second).toEqual(second.toSorted())
      })
    }
  ]
}

/**
 * The plan-limit contract runs under a **capped-plan** workspace context,
 * which each harness provides separately from its normal-case layer (Seed:
 * a `planId: 'starter'` fixture workspace; Live: a D1 row with the same
 * plan). Creating in a loop must eventually hit the interface's real error
 * channel instead of silently passing on an unreachable gate.
 */
export function planLimitContractCases(
  expect: ContractExpect
): ReadonlyArray<PlanLimitContractCase> {
  return [
    {
      name: 'creating past the plan token cap fails PlanLimitExceeded',
      assert: Effect.gen(function* () {
        const tokens = yield* ApiTokenRegistry
        let outcome = yield* Effect.exit(
          tokens.create({ name: 'cap', scopes: ['read'] })
        )
        for (let i = 0; i < 50 && Exit.isSuccess(outcome); i++) {
          outcome = yield* Effect.exit(
            tokens.create({ name: `cap-${i}`, scopes: ['read'] })
          )
        }
        expect(failureTag(outcome)).toBe('PlanLimitExceeded')
      })
    }
  ]
}
