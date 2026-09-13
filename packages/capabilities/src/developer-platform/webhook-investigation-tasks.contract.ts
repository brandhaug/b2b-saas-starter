import { Effect, Exit } from 'effect'

import { type PlanLimitExceeded } from '@b2b-saas-starter/billing/errors'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type ContractExpect } from '../governance/contract-expect.ts'
import { failureTag } from '../internal/failure-tag.ts'
import { type Workspace } from '../governance/workspace-identity.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import {
  type WebhookDeliveryNotFound,
  type WebhookDispatchRejected,
  type WebhookEndpointNotFound,
  WebhookEndpoints
} from './webhook-endpoints.ts'
import { type InvalidWebhookUrl } from './webhook-url.ts'
import {
  type WebhookInvestigationTaskNotFound,
  type WebhookInvestigationTaskRejected,
  WebhookInvestigationTasks
} from './webhook-investigation-tasks.ts'

type WebhookInvestigationTaskContractCase = {
  readonly name: string
  readonly assert: Effect.Effect<
    void,
    | CapabilityUnavailable
    | InvalidWebhookUrl
    | PlanLimitExceeded
    | WebhookDeliveryNotFound
    | WebhookDispatchRejected
    | WebhookEndpointNotFound
    | WebhookInvestigationTaskNotFound
    | WebhookInvestigationTaskRejected,
    WebhookEndpoints | WebhookInvestigationTasks | WorkspaceContext
  >
}

type PreparedDelivery = {
  readonly endpointId: string
  readonly deliveryId: string
  readonly workspaceId: string
  readonly eventType: string
}

/**
 * Builds delivery evidence through the endpoint service so both task adapters
 * receive the same persisted source shape without reaching into storage.
 */
export function prepareInvestigationDelivery(
  suffix: string,
  status: 'failed' | 'dead_lettered'
) {
  return Effect.gen(function* () {
    const webhooks = yield* WebhookEndpoints
    const ctx = yield* WorkspaceContext
    const eventType = `investigation.${suffix}`
    const { endpoint } = yield* webhooks.create({
      url: `https://example.com/investigation/${suffix}`,
      events: [eventType]
    })
    const queued = yield* webhooks.sendTestEvent({ endpointId: endpoint.id })
    yield* webhooks.recordDeliveryAttempt({
      id: queued.deliveryId,
      endpointId: endpoint.id,
      workspaceId: ctx.workspace.id,
      eventType,
      status: 'failed',
      attempts: 1,
      responseStatus: 503,
      payload: { eventType, secret: 'must not be copied' },
      requestHeaders: { authorization: 'must not be copied' },
      responseBody: 'must not be copied'
    })
    if (status === 'dead_lettered') {
      yield* webhooks.recordTerminalDeliveryAttempt({
        deliveryId: queued.deliveryId,
        endpointId: endpoint.id,
        workspaceId: ctx.workspace.id,
        eventType,
        attempts: 2,
        status,
        payload: { eventType, secret: 'must not be copied' }
      })
    }
    return {
      endpointId: endpoint.id,
      deliveryId: queued.deliveryId,
      workspaceId: ctx.workspace.id,
      eventType
    } satisfies PreparedDelivery
  })
}

const foreignWorkspace = {
  id: 'wrk_investigation_foreign',
  slug: 'investigation-foreign-lab',
  name: 'Investigation Foreign Lab',
  planId: 'team'
} satisfies Workspace

export function webhookInvestigationTaskContractCases(
  expect: ContractExpect
): ReadonlyArray<WebhookInvestigationTaskContractCase> {
  return [
    {
      name: 'saves bounded typed evidence without payload, headers, or response body',
      assert: Effect.gen(function* () {
        const source = yield* prepareInvestigationDelivery('evidence', 'dead_lettered')
        const tasks = yield* WebhookInvestigationTasks
        const task = yield* tasks.create({
          deliveryId: source.deliveryId,
          question: 'Why did this delivery fail?'
        })

        expect(task).toMatchObject({
          sourceDeliveryId: source.deliveryId,
          question: 'Why did this delivery fail?',
          status: 'proposed',
          diagnosis: 'receiver_unavailable',
          replayDeliveryId: null,
          outcome: null
        })
        expect(task.evidence).toMatchObject({
          endpointId: source.endpointId,
          endpointUrl: 'https://example.com/investigation/evidence',
          eventType: 'webhook.test_event',
          deliveryStatus: 'dead_lettered',
          lastResponseStatus: 503
        })
        expect('payload' in task.evidence).toBe(false)
        expect('requestHeaders' in task.evidence).toBe(false)
        expect('responseBody' in task.evidence).toBe(false)
        expect(Object.keys(task.evidence.attempts[0] ?? {}).toSorted()).toEqual([
          'attemptedAt',
          'id',
          'responseStatus',
          'status'
        ])
      })
    },
    {
      name: 'creates a completed finding for a delivery that is still retrying',
      assert: Effect.gen(function* () {
        const source = yield* prepareInvestigationDelivery('retrying', 'failed')
        const tasks = yield* WebhookInvestigationTasks
        const task = yield* tasks.create({
          deliveryId: source.deliveryId,
          question: 'Is the queue retrying this delivery?'
        })

        expect(task).toMatchObject({
          status: 'completed',
          diagnosis: 'retrying',
          replayDeliveryId: null,
          outcome: null
        })
        expect(failureTag(yield* Effect.exit(tasks.approve({ taskId: task.id })))).toBe(
          'WebhookInvestigationTaskRejected'
        )
      })
    },
    {
      name: 'cancellation prevents a proposal from being approved',
      assert: Effect.gen(function* () {
        const source = yield* prepareInvestigationDelivery('cancel', 'dead_lettered')
        const tasks = yield* WebhookInvestigationTasks
        const task = yield* tasks.create({
          deliveryId: source.deliveryId,
          question: 'Cancel this investigation'
        })
        const cancelled = yield* tasks.cancel({ taskId: task.id })
        expect(cancelled).toMatchObject({
          id: task.id,
          status: 'cancelled',
          replayDeliveryId: null
        })
        expect(failureTag(yield* Effect.exit(tasks.approve({ taskId: task.id })))).toBe(
          'WebhookInvestigationTaskRejected'
        )
      })
    },
    {
      name: 'duplicate approval reuses the same replay identity',
      assert: Effect.gen(function* () {
        const source = yield* prepareInvestigationDelivery('duplicate', 'dead_lettered')
        const tasks = yield* WebhookInvestigationTasks
        const webhooks = yield* WebhookEndpoints
        const task = yield* tasks.create({
          deliveryId: source.deliveryId,
          question: 'Replay this once'
        })
        const first = yield* tasks.approve({ taskId: task.id })
        const second = yield* tasks.approve({ taskId: task.id })

        expect(first).toMatchObject({
          status: 'approved',
          replayDeliveryId: `replay_${task.id}`,
          outcome: 'pending'
        })
        expect(second).toMatchObject({
          status: 'approved',
          replayDeliveryId: first.replayDeliveryId,
          outcome: 'pending'
        })
        const deliveries = yield* webhooks.listDeliveries({
          endpointId: source.endpointId
        })
        expect(
          deliveries.filter((delivery) => delivery.id === first.replayDeliveryId)
        ).toHaveLength(1)
      })
    },
    {
      name: 'changed endpoint URL blocks a stale approval proposal',
      assert: Effect.gen(function* () {
        const source = yield* prepareInvestigationDelivery(
          'changed-url',
          'dead_lettered'
        )
        const tasks = yield* WebhookInvestigationTasks
        const webhooks = yield* WebhookEndpoints
        const task = yield* tasks.create({
          deliveryId: source.deliveryId,
          question: 'Replay only the original endpoint'
        })
        yield* webhooks.update({
          endpointId: source.endpointId,
          url: 'https://example.com/investigation/changed-url-now'
        })

        expect(failureTag(yield* Effect.exit(tasks.approve({ taskId: task.id })))).toBe(
          'WebhookInvestigationTaskRejected'
        )
        expect((yield* tasks.get({ taskId: task.id })).status).toBe('proposed')
      })
    },
    {
      name: 'changed endpoint URL removes the dispatch target for an approved replay',
      assert: Effect.gen(function* () {
        const source = yield* prepareInvestigationDelivery(
          'approved-url-change',
          'dead_lettered'
        )
        const tasks = yield* WebhookInvestigationTasks
        const webhooks = yield* WebhookEndpoints
        const task = yield* tasks.create({
          deliveryId: source.deliveryId,
          question: 'Do not dispatch after this endpoint changes'
        })
        const approved = yield* tasks.approve({ taskId: task.id })
        const replayDeliveryId = approved.replayDeliveryId ?? ''
        expect(replayDeliveryId).toBe(`replay_${task.id}`)
        yield* webhooks.update({
          endpointId: source.endpointId,
          url: 'https://example.com/investigation/approved-url-change-now'
        })

        expect(
          yield* webhooks.getDispatchTarget(
            source.endpointId,
            source.workspaceId,
            replayDeliveryId
          )
        ).toBe(null)
      })
    },
    {
      name: 'task outcome follows the recorded replay delivery',
      assert: Effect.gen(function* () {
        const source = yield* prepareInvestigationDelivery('outcome', 'dead_lettered')
        const tasks = yield* WebhookInvestigationTasks
        const webhooks = yield* WebhookEndpoints
        const task = yield* tasks.create({
          deliveryId: source.deliveryId,
          question: 'Did the replay arrive?'
        })
        const approved = yield* tasks.approve({ taskId: task.id })
        const replayDeliveryId = approved.replayDeliveryId ?? ''
        expect(replayDeliveryId).toBe(`replay_${task.id}`)
        expect(approved.outcome).toBe('pending')
        yield* webhooks.recordDeliveryAttempt({
          id: replayDeliveryId,
          endpointId: source.endpointId,
          workspaceId: source.workspaceId,
          eventType: source.eventType,
          status: 'delivered',
          attempts: 1,
          responseStatus: 204,
          payload: { replay: true }
        })
        expect((yield* tasks.get({ taskId: task.id })).outcome).toBe('delivered')
      })
    },
    {
      name: 'a task cannot be read from another workspace context',
      assert: Effect.gen(function* () {
        const source = yield* prepareInvestigationDelivery('scope', 'dead_lettered')
        const tasks = yield* WebhookInvestigationTasks
        const task = yield* tasks.create({
          deliveryId: source.deliveryId,
          question: 'Keep this workspace scoped'
        })
        const foreign = yield* Effect.exit(
          tasks.get({ taskId: task.id }).pipe(
            Effect.provideService(WorkspaceContext, {
              workspace: foreignWorkspace,
              actor: null,
              actorType: 'user'
            })
          )
        )

        expect(Exit.isFailure(foreign)).toBe(true)
        expect(failureTag(foreign)).toBe('WebhookInvestigationTaskNotFound')
      })
    }
  ]
}
