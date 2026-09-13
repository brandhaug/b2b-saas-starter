import { Effect, Layer } from 'effect'
import { expect, layer } from '@effect/vitest'
import { eq } from 'drizzle-orm'
import { Database } from '@b2b-saas-starter/db/service'
import { webhookEndpoints } from '@b2b-saas-starter/db/schema'
import { WebhookEndpoints } from './webhook-endpoints.ts'
import {
  LiveWebhookPublisher,
  WebhookPublisher,
  type WebhookPayload
} from './webhook-publisher.ts'
import { LiveAuditEventLog } from '../governance/audit-event-log.live.ts'
import { WorkspaceMembership } from '../governance/workspace-membership.ts'
import {
  fakeMemberBinding,
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })('publisher', (it) => {
  it.effect('scopes fan-out and persists only the allowlisted payload', () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* db
        .update(webhookEndpoints)
        .set({ events: ['workspace_member.added'] })
        .where(eq(webhookEndpoints.id, 'wh_live'))
      const messages: Array<unknown> = []
      const publisher = yield* Effect.service(WebhookPublisher).pipe(
        Effect.provide(
          LiveWebhookPublisher({
            send: (message) => {
              messages.push(message)
              return Promise.resolve()
            },
            sendBatch: (batch) => {
              for (const message of batch) {
                messages.push(message)
              }
              return Promise.resolve()
            }
          }).pipe(Layer.provide(LiveAuditEventLog))
        )
      )
      const memberPayload: WebhookPayload['workspace_member.added'] = {
        userId: 'usr_joiner',
        role: 'member'
      }
      const payloadWithPrivateFields = {
        ...memberPayload,
        email: 'secret@webhook.test',
        signingSecret: 'never-send'
      }
      yield* publisher.publishForWorkspace('wrk_live', {
        eventType: 'workspace_member.added',
        payload: payloadWithPrivateFields
      })
      yield* publisher.publishForWorkspace('wrk_other', {
        eventType: 'workspace_member.added',
        payload: { userId: 'usr_other', role: 'member' }
      })
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({
        body: {
          workspaceId: 'wrk_live',
          endpointId: 'wh_live',
          eventType: 'workspace_member.added',
          payload: { userId: 'usr_joiner', role: 'member' }
        }
      })
      const rows = yield* inWorkspace(
        'live-lab',
        Effect.flatMap(WebhookEndpoints, (endpoints) =>
          endpoints.listDeliveries({ endpointId: 'wh_live' })
        )
      )
      const deliveries = rows.filter(
        (delivery) => delivery.eventType === 'workspace_member.added'
      )
      expect(deliveries).toHaveLength(1)
      expect(deliveries[0]?.payload).toEqual({
        userId: 'usr_joiner',
        role: 'member'
      })
    })
  )

  it.effect('publishes a Live membership mutation through the queue', () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* db.insert(webhookEndpoints).values({
        id: 'wh_member_baseline',
        workspaceId: 'wrk_member_contract',
        url: 'https://example.com/member-hook',
        signingSecret: 'whsec_member_test',
        enabled: true,
        events: ['workspace_member.role_changed'],
        createdAt: '2026-09-01T00:00:00.000Z'
      })
      const messages: Array<unknown> = []
      const { binding } = fakeMemberBinding(db)
      yield* inWorkspace(
        'member-contract-lab',
        Effect.gen(function* () {
          const membership = yield* WorkspaceMembership
          yield* membership.changeRole({ userId: 'usr_mover', role: 'admin' })
        }),
        { userId: 'usr_owner' },
        {
          memberBinding: binding,
          webhookQueue: {
            send: (message) => {
              messages.push(message)
              return Promise.resolve()
            },
            sendBatch: (batch) => {
              for (const message of batch) {
                messages.push(message)
              }
              return Promise.resolve()
            }
          }
        }
      )
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({
        body: {
          workspaceId: 'wrk_member_contract',
          eventType: 'workspace_member.role_changed',
          payload: { userId: 'usr_mover', role: 'admin' }
        }
      })
    })
  )
})
