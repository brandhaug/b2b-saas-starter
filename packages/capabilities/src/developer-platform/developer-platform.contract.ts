import { Effect, Exit } from 'effect'
import { type ContractExpectMatchers } from '../governance/contract-expect.ts'
import { failureTag } from '../internal/failure-tag.ts'
import { type CapabilityUnavailable, type PlanLimitExceeded } from '../errors.ts'
import { type InvalidWebhookUrl } from './webhook-url.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { ApiTokenRegistry } from './api-token-registry.ts'
import {
  WEBHOOK_TEST_EVENT_TYPE,
  type WebhookDispatchRejected,
  type WebhookEndpointNotFound,
  type WebhookDeliveryNotFound,
  WebhookEndpoints
} from './webhook-endpoints.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { walkKeysetPages } from '../internal/keyset-cursor.ts'

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
    | CapabilityUnavailable
    | InvalidWebhookUrl
    | PlanLimitExceeded
    | WebhookEndpointNotFound
    | WebhookDeliveryNotFound
    | WebhookDispatchRejected,
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
      name: 'an endpoint disabled through update stops resolving dispatch targets',
      assert: Effect.gen(function* () {
        const webhooks = yield* WebhookEndpoints
        const ctx = yield* WorkspaceContext
        const { endpoint } = yield* webhooks.create({
          url: 'https://example.com/disable-hook',
          events: ['demo.event']
        })

        yield* webhooks.update({ endpointId: endpoint.id, enabled: false })
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
          nextAttemptAt: null,
          payload: { tokenId: 'tok_first' }
        })
        yield* webhooks.recordDeliveryAttempt({
          id: 'whd_contract_second',
          endpointId: endpoint.id,
          workspaceId: 'irrelevant-to-list-scoping',
          eventType: 'demo.event',
          status: 'failed',
          attempts: 2,
          responseStatus: 500,
          nextAttemptAt: null,
          payload: { tokenId: 'tok_second' }
        })

        const deliveries = yield* webhooks.listDeliveries({
          endpointId: endpoint.id
        })
        // Newest first is a total order both adapters keep: `lastAttemptAt`
        // desc with the row id as the tie-break, so even two rows recorded in
        // the same instant (TestClock freezes time on the seed side) sequence
        // deterministically.
        expect(deliveries.map((row) => row.id)).toEqual([
          'whd_contract_second',
          'whd_contract_first'
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
          deliveryId: 'whd_contract_dlq',
          endpointId: endpoint.id,
          workspaceId: ctx.workspace.id,
          eventType: 'demo.event',
          attempts: 5,
          status: 'dead_lettered',
          payload: { tokenId: 'tok_dlq' }
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
      name: 'update writes only the provided fields and 404s a foreign endpoint',
      assert: Effect.gen(function* () {
        const webhooks = yield* WebhookEndpoints
        const { endpoint } = yield* webhooks.create({
          url: 'https://example.com/update-hook',
          events: ['demo.event']
        })

        const updated = yield* webhooks.update({
          endpointId: endpoint.id,
          events: ['demo.event', 'demo.other'],
          enabled: false
        })
        expect(updated.url).toBe('https://example.com/update-hook')
        expect(updated.enabled).toBe(false)
        expect(updated.events).toEqual(['demo.event', 'demo.other'])

        // A disabled endpoint can be re-enabled through update — the one way
        // back from `disable`.
        const reEnabled = yield* webhooks.update({
          endpointId: endpoint.id,
          enabled: true
        })
        expect(reEnabled.enabled).toBe(true)

        const outcome = yield* Effect.exit(
          webhooks.update({ endpointId: 'wh_missing', enabled: false })
        )
        expect(failureTag(outcome)).toBe('WebhookEndpointNotFound')

        // An updated URL re-validates against the SSRF guard on both adapters.
        const invalid = yield* Effect.exit(
          webhooks.update({ endpointId: endpoint.id, url: 'http://localhost/hook' })
        )
        expect(failureTag(invalid)).toBe('InvalidWebhookUrl')
      })
    },
    {
      name: 'delete removes the endpoint, its deliveries, and its dispatch target',
      assert: Effect.gen(function* () {
        const webhooks = yield* WebhookEndpoints
        const ctx = yield* WorkspaceContext
        const { endpoint } = yield* webhooks.create({
          url: 'https://example.com/delete-hook',
          events: ['demo.event']
        })
        yield* webhooks.recordDeliveryAttempt({
          id: 'whd_contract_delete',
          endpointId: endpoint.id,
          workspaceId: ctx.workspace.id,
          eventType: 'demo.event',
          status: 'delivered',
          attempts: 1,
          responseStatus: 200,
          payload: { tokenId: 'tok_delete' }
        })

        yield* webhooks.delete({ endpointId: endpoint.id })
        expect((yield* webhooks.list).some((each) => each.id === endpoint.id)).toBe(
          false
        )
        // The delivery rows cascaded with the endpoint row.
        expect(
          yield* webhooks.listDeliveries({ endpointId: endpoint.id })
        ).toHaveLength(0)
        expect(yield* webhooks.getDispatchTarget(endpoint.id, ctx.workspace.id)).toBe(
          null
        )
        // Deleting a second time matches nothing — the same 404 as update.
        const deleted = yield* Effect.exit(webhooks.delete({ endpointId: endpoint.id }))
        expect(failureTag(deleted)).toBe('WebhookEndpointNotFound')
      })
    },
    {
      name: 'replay creates a pending copy with attempts reset and a replayedFrom link',
      assert: Effect.gen(function* () {
        const webhooks = yield* WebhookEndpoints
        const log = yield* AuditEventLog
        const ctx = yield* WorkspaceContext
        const { endpoint } = yield* webhooks.create({
          url: 'https://example.com/replay-hook',
          events: ['demo.event']
        })
        yield* webhooks.recordDeliveryAttempt({
          id: 'whd_contract_failed',
          endpointId: endpoint.id,
          // Terminal statuses batch an audit event scoped to this workspace,
          // so the real id is required (the FK is real on D1).
          workspaceId: ctx.workspace.id,
          eventType: 'demo.event',
          status: 'dead_lettered',
          attempts: 6,
          responseStatus: 503,
          payload: { tokenId: 'tok_replay' }
        })
        const auditsBefore = (yield* log.listGlobal).filter(
          (event) => event.eventType === 'webhook.delivery_replayed'
        ).length

        const replayed = yield* webhooks.replayDelivery({
          deliveryId: 'whd_contract_failed'
        })

        const rows = yield* webhooks.listDeliveries({ endpointId: endpoint.id })
        const copy = rows.find((row) => row.id === replayed.deliveryId)
        expect(copy === undefined).toBe(false)
        expect(copy).toMatchObject({
          status: 'pending',
          attempts: 0,
          replayedFrom: 'whd_contract_failed',
          eventType: 'demo.event',
          responseStatus: null
        })
        expect(copy?.payload).toEqual({ tokenId: 'tok_replay' })
        // The source row is untouched — replay adds history, it never rewrites it.
        const source = rows.find((row) => row.id === 'whd_contract_failed')
        expect(source).toMatchObject({ status: 'dead_lettered', attempts: 6 })
        // The replay audited itself.
        const auditsAfter = (yield* log.listGlobal).filter(
          (event) => event.eventType === 'webhook.delivery_replayed'
        ).length
        expect(auditsAfter).toBe(auditsBefore + 1)

        // A delivered row offers no replay, and a foreign id reads as not found.
        const deliveredOutcome = yield* Effect.exit(
          webhooks.replayDelivery({ deliveryId: replayed.deliveryId })
        )
        expect(failureTag(deliveredOutcome)).toBe('WebhookDispatchRejected')
        const missingOutcome = yield* Effect.exit(
          webhooks.replayDelivery({ deliveryId: 'whd_missing' })
        )
        expect(failureTag(missingOutcome)).toBe('WebhookDeliveryNotFound')
      })
    },
    {
      name: 'sendTestEvent queues a pending webhook.test_event to one endpoint',
      assert: Effect.gen(function* () {
        const webhooks = yield* WebhookEndpoints
        const { endpoint } = yield* webhooks.create({
          url: 'https://example.com/test-hook',
          events: ['demo.event']
        })

        const sent = yield* webhooks.sendTestEvent({ endpointId: endpoint.id })

        const rows = yield* webhooks.listDeliveries({ endpointId: endpoint.id })
        const row = rows.find((candidate) => candidate.id === sent.deliveryId)
        expect(row).toMatchObject({
          status: 'pending',
          attempts: 0,
          eventType: WEBHOOK_TEST_EVENT_TYPE
        })

        // Unknown endpoint 404s; a disabled one refuses the dispatch.
        const missing = yield* Effect.exit(
          webhooks.sendTestEvent({ endpointId: 'wh_missing' })
        )
        expect(failureTag(missing)).toBe('WebhookEndpointNotFound')
        yield* webhooks.update({ endpointId: endpoint.id, enabled: false })
        const disabled = yield* Effect.exit(
          webhooks.sendTestEvent({ endpointId: endpoint.id })
        )
        expect(failureTag(disabled)).toBe('WebhookDispatchRejected')
      })
    },
    {
      // Runs last in the list on purpose: it creates rows, and the walk
      // assertions are order-independent but the later coverage suites are not.
      name: 'token pages walk exactly once and an insert never disturbs the emitted prefix',
      assert: Effect.gen(function* () {
        const tokens = yield* ApiTokenRegistry
        function walk() {
          return walkKeysetPages((input) => tokens.listPage(input), { limit: 1 })
        }
        // The walk runs to exhaustion — a truncated walk would fail the
        // coverage assertions below against the whole-collection read.
        const firstWalk = yield* walk()
        expect(firstWalk.exhausted).toBe(true)
        const first = firstWalk.items.map((token) => token.id)
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
        const second = (yield* walk()).items.map((token) => token.id)
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
        function walk() {
          return walkKeysetPages((input) => webhooks.listPage(input), { limit: 1 })
        }
        const first = (yield* walk()).items.map((endpoint) => endpoint.id)
        // Forward order on `id ASC` — the wire shape carries no timestamp,
        // so the id is the one stable order a page can resume.
        expect(first).toEqual(first.toSorted())

        const { endpoint } = yield* webhooks.create({
          url: 'https://example.com/paging-hook',
          events: ['demo.event']
        })
        const second = (yield* walk()).items.map((row) => row.id)
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
