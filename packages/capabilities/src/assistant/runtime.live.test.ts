import { expect, layer } from '@effect/vitest'
import { Clock, Effect, Layer } from 'effect'
import { Database } from '@b2b-saas-starter/db/service'
import { eq } from 'drizzle-orm'
import {
  webhookInvestigationTasks,
  webhookDeliveries,
  webhookEndpoints
} from '@b2b-saas-starter/db/schema'
import { TestDatabase, LIVE_SUITE_TIMEOUT } from '../testing/live-harness.ts'
import { liveWorkspaceContext } from '../workspace-context.ts'
import { AssistantAdmission } from './admission.ts'
import { AssistantAuthority } from '../developer-platform/assistant-authority.ts'
import { AssistantDirectory } from './directory.ts'
import { assistantTaskEvidence } from '../developer-platform/assistant-task-evidence.ts'
import { LiveConversationHost } from './runtime.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'conversation host composition',
  (it) => {
    it.effect(
      'reads scoped task evidence and shares directory revisions without optional providers',
      () =>
        Effect.gen(function* () {
          const db = yield* Database
          yield* db.insert(webhookInvestigationTasks).values({
            id: 'host-task',
            workspaceId: 'wrk_live',
            status: 'completed',
            replayDeliveryId: null,
            record: {
              sourceDeliveryId: 'source',
              requestedBy: 'usr_owner',
              question: 'Check',
              diagnosis: 'delivered',
              evidence: {
                endpointId: 'endpoint',
                endpointUrl: 'https://private.example',
                eventType: 'member.created',
                deliveryStatus: 'delivered',
                lastResponseStatus: 200,
                attempts: []
              }
            },
            createdAt: '2026-09-23T00:00:00Z',
            updatedAt: '2026-09-23T00:00:00Z'
          })
          yield* Effect.gen(function* () {
            const directory = yield* AssistantDirectory
            const room = yield* directory.create({
              id: 'host-room',
              workspaceId: 'wrk_live',
              creatorUserId: 'usr_owner'
            })
            const evidence = yield* assistantTaskEvidence('host-task')
            expect(evidence).toMatchObject({ taskId: 'host-task', sourceId: 'source' })
            expect(evidence?.text).toContain('"outcome":null')
            expect(evidence?.text).not.toContain('private.example')
            expect(yield* assistantTaskEvidence('missing')).toBeNull()
            const admission = yield* AssistantAdmission
            const now = yield* Clock.currentTimeMillis
            yield* admission.reserve({
              id: 'host-reservation',
              conversationId: room.id,
              workspaceId: room.workspaceId,
              userId: room.creatorUserId,
              deadline: now + 60_000,
              activeLimit: 1,
              rateLimit: 10
            })
            yield* admission.commit('host-reservation')
            yield* admission.release('host-reservation')
            const authority = yield* AssistantAuthority
            expect(
              (yield* Effect.flip(
                authority.authorize({
                  credential: {
                    kind: 'session',
                    userId: 'usr_owner',
                    sessionId: 'missing',
                    expiresAt: now + 60_000
                  },
                  workspaceId: room.workspaceId,
                  requiredPermissions: [],
                  operation: 'read',
                  mode: 'observe'
                })
              ))._tag
            ).toBe('AssistantAuthorityDenied')
            yield* db.insert(webhookEndpoints).values({
              id: 'host-endpoint',
              workspaceId: 'wrk_live',
              url: 'https://private.example',
              signingSecret: 'private',
              events: [],
              createdAt: '2026-09-23T00:00:00Z'
            })
            yield* db.insert(webhookDeliveries).values({
              id: 'host-replay',
              endpointId: 'host-endpoint',
              eventType: 'member.created',
              status: 'pending',
              payload: {}
            })
            yield* db
              .update(webhookInvestigationTasks)
              .set({ replayDeliveryId: 'host-replay' })
              .where(eq(webhookInvestigationTasks.id, 'host-task'))
            expect((yield* assistantTaskEvidence('host-task'))?.text).toContain(
              '"outcome":"pending"'
            )
            yield* db
              .update(webhookDeliveries)
              .set({ status: 'delivered' })
              .where(eq(webhookDeliveries.id, 'host-replay'))
            expect((yield* assistantTaskEvidence('host-task'))?.text).toContain(
              '"outcome":"delivered"'
            )
            yield* db
              .update(webhookDeliveries)
              .set({ status: 'dead_lettered' })
              .where(eq(webhookDeliveries.id, 'host-replay'))
            expect((yield* assistantTaskEvidence('host-task'))?.text).toContain(
              '"outcome":"failed"'
            )
            yield* db
              .update(webhookEndpoints)
              .set({ workspaceId: 'wrk_other' })
              .where(eq(webhookEndpoints.id, 'host-endpoint'))
            expect((yield* assistantTaskEvidence('host-task'))?.text).toContain(
              '"outcome":"unavailable"'
            )
            yield* directory.invalidateAccess(
              { conversationId: room.id },
              { interruptRuns: true }
            )
            expect(yield* directory.policyMatches(room.id, room.policyRevision)).toBe(
              false
            )
          }).pipe(
            Effect.provide(
              Layer.merge(
                LiveConversationHost(),
                liveWorkspaceContext('live-lab', { userId: 'usr_owner' }, 'user')
              )
            )
          )
          yield* Effect.gen(function* () {
            expect(yield* assistantTaskEvidence('host-task')).toBeNull()
          }).pipe(
            Effect.provide(
              Layer.merge(
                LiveConversationHost(),
                liveWorkspaceContext('other-lab', undefined, 'system')
              )
            )
          )
        })
    )
  }
)
