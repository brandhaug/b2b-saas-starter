import { eq } from 'drizzle-orm'
import { AssistantDirectory } from './directory.ts'
import { AssistantAdmission } from './admission.ts'
import { assistantLifecycleContractCases } from './lifecycle.contract.ts'
import { describe, expect, layer } from '@effect/vitest'
import { Clock, Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { provisionTestD1 } from '@b2b-saas-starter/db/testing'
import { Database, layerFromD1 } from '@b2b-saas-starter/db/service'
import {
  user,
  workspaces,
  auditEvents,
  workspaceMembers
} from '@b2b-saas-starter/db/schema'
import { LiveAuditEventLog } from '../governance/audit-event-log.live.ts'
import { assistantDirectoryContractCases } from './directory.contract.ts'
import { LiveAssistantDirectory } from './directory.live.ts'
import { LiveAssistantAdmission } from './admission.live.ts'

const database = Layer.unwrap(
  Effect.gen(function* () {
    const provisioned = yield* Effect.acquireRelease(
      Effect.promise(provisionTestD1),
      (resource) => Effect.promise(resource.dispose)
    )
    const binding = layerFromD1(provisioned.d1)
    yield* Effect.gen(function* () {
      const db = yield* Database
      yield* db.insert(user).values([
        { id: 'owner', email: 'owner@assistant.test', name: 'Owner' },
        { id: 'other', email: 'other@assistant.test', name: 'Other' },
        ...['export-owner', 'restore-owner', 'cleanup-owner'].map((id) => ({
          id,
          email: `${id}@assistant.test`,
          name: id
        }))
      ])
      yield* db.insert(workspaces).values(
        ['workspace', 'concurrent', 'expiry', 'rate'].map((id) => ({
          id,
          slug: id,
          name: id
        }))
      )
    }).pipe(Effect.provide(binding))
    return binding
  })
)
const storage = Layer.merge(LiveAssistantDirectory(), LiveAssistantAdmission).pipe(
  Layer.provide(LiveAuditEventLog),
  Layer.provideMerge(database)
)
describe('Live assistant directory and admission contract', () => {
  layer(storage, { timeout: '60 seconds' })('D1 atomic admission', (it) => {
    it.effect(
      'retains a membership and suspension revocation even when access is restored before polling',
      () =>
        Effect.gen(function* () {
          const db = yield* Database
          const directory = yield* AssistantDirectory
          yield* db.insert(workspaces).values({
            id: 'revocation-workspace',
            slug: 'revocation-workspace',
            name: 'Revocation'
          })
          const member = {
            id: 'revocation-member',
            workspaceId: 'revocation-workspace',
            userId: 'owner',
            role: 'member'
          } satisfies typeof workspaceMembers.$inferInsert
          yield* db.insert(workspaceMembers).values(member)
          const row = yield* directory.create({
            id: 'revocation-room',
            workspaceId: member.workspaceId,
            creatorUserId: member.userId
          })
          const unrelated = yield* directory.create({
            id: 'revocation-unrelated',
            workspaceId: 'concurrent',
            creatorUserId: member.userId
          })
          yield* db
            .update(workspaceMembers)
            .set({ role: 'admin' })
            .where(eq(workspaceMembers.id, member.id))
          yield* db
            .update(workspaceMembers)
            .set({ role: 'member' })
            .where(eq(workspaceMembers.id, member.id))
          expect((yield* directory.get(row.id))?.runAccessRevision).toBe(2)
          yield* db.delete(workspaceMembers).where(eq(workspaceMembers.id, member.id))
          yield* db.insert(workspaceMembers).values(member)
          expect((yield* directory.get(row.id))?.runAccessRevision).toBe(3)
          yield* db
            .update(workspaces)
            .set({ suspensionStatus: 'suspended' })
            .where(eq(workspaces.id, member.workspaceId))
          yield* db
            .update(workspaces)
            .set({ suspensionStatus: 'active' })
            .where(eq(workspaces.id, member.workspaceId))
          expect((yield* directory.get(row.id))?.runAccessRevision).toBe(5)
          expect(yield* directory.get(unrelated.id)).toEqual(unrelated)
          yield* directory.fence({ conversationId: row.id })
          yield* directory.completeCleanup(row.id)
          yield* directory.fence({ conversationId: unrelated.id })
          yield* directory.completeCleanup(unrelated.id)
        })
    )

    it.effect('persists the stricter policy when notifying its host fails', () =>
      Effect.gen(function* () {
        const notified: Array<ReadonlyArray<string>> = []
        const notifying = LiveAssistantDirectory(undefined, (addresses) => {
          notified.push(addresses.map((address) => address.id))
          return Promise.reject(new Error('Host unavailable'))
        }).pipe(Layer.provide(LiveAuditEventLog))
        yield* Effect.gen(function* () {
          const directory = yield* AssistantDirectory
          const row = yield* directory.create({
            id: 'notify-policy',
            workspaceId: 'concurrent',
            creatorUserId: 'other'
          })
          const updated = yield* directory.raisePolicy(row.id, ['webhook:list'])
          expect(updated.requiredPermissions).toEqual(['webhook:list'])
          expect(yield* directory.policyMatches(row.id, row.policyRevision)).toBe(false)
          yield* directory.invalidateAccess({ conversationId: row.id })
          expect(notified).toEqual([['notify-policy'], ['notify-policy']])
          expect(yield* directory.policyMatches(row.id, updated.policyRevision)).toBe(
            false
          )
        }).pipe(Effect.provide(notifying))
      })
    )

    it.effect(
      'preserves cleanup addresses and releases an active slot before a parent row disappears',
      () =>
        Effect.gen(function* () {
          const db = yield* Database
          const directory = yield* AssistantDirectory
          const admission = yield* AssistantAdmission
          yield* db
            .insert(workspaces)
            .values({ id: 'parent-deleted', slug: 'parent-deleted', name: 'Parent' })
          yield* directory.create({
            id: 'parent-conversation',
            workspaceId: 'parent-deleted',
            creatorUserId: 'owner'
          })
          const now = yield* Clock.currentTimeMillis
          yield* admission.reserve({
            id: 'parent-reservation',
            conversationId: 'parent-conversation',
            workspaceId: 'parent-deleted',
            userId: 'owner',
            deadline: now + 600_000,
            activeLimit: 3,
            rateLimit: 20
          })
          yield* db.delete(workspaces).where(eq(workspaces.id, 'parent-deleted'))
          const row = yield* directory.get('parent-conversation')
          expect(row?.workspaceId).toBe('parent-deleted')
          expect(row?.creatorUserId).toBe('owner')
          expect(row?.deletedAt).not.toBeNull()
          expect(
            (yield* admission.commit('parent-reservation').pipe(Effect.result))._tag
          ).toBe('Failure')
          expect(
            (yield* directory
              .create({
                id: 'late-create',
                workspaceId: 'parent-deleted',
                creatorUserId: 'owner'
              })
              .pipe(Effect.result))._tag
          ).toBe('Failure')
          yield* directory.completeCleanup('parent-conversation')
        })
    )

    it.effect(
      'audits each winning transition once under duplicate and concurrent requests',
      () =>
        Effect.gen(function* () {
          const db = yield* Database
          const directory = yield* AssistantDirectory
          const admission = yield* AssistantAdmission
          const now = yield* Clock.currentTimeMillis
          yield* db.insert(workspaces).values({
            id: 'audit-retries',
            slug: 'audit-retries',
            name: 'Audit retries'
          })
          const identity = {
            id: 'audit-conversation',
            workspaceId: 'audit-retries',
            creatorUserId: 'owner'
          }
          yield* Effect.all([directory.create(identity), directory.create(identity)], {
            concurrency: 'unbounded'
          })
          yield* directory.create(identity)
          yield* Effect.all(
            [
              directory.raisePolicy(identity.id, ['assistant:read', 'webhook:list']),
              directory.raisePolicy(identity.id, ['assistant:read', 'webhook:list'])
            ],
            { concurrency: 'unbounded' }
          )
          yield* directory.raisePolicy(identity.id, ['assistant:read', 'webhook:list'])
          const reserve = {
            id: 'audit-reservation',
            conversationId: identity.id,
            workspaceId: identity.workspaceId,
            userId: identity.creatorUserId,
            deadline: now + 600_000,
            activeLimit: 3,
            rateLimit: 20
          }
          yield* Effect.all([admission.reserve(reserve), admission.reserve(reserve)], {
            concurrency: 'unbounded'
          })
          yield* Effect.all(
            [admission.commit(reserve.id), admission.commit(reserve.id)],
            { concurrency: 'unbounded' }
          )
          yield* admission.commit(reserve.id)
          yield* Effect.all(
            [admission.release(reserve.id), admission.release(reserve.id)],
            { concurrency: 'unbounded' }
          )
          yield* admission.release(reserve.id)
          yield* admission.release('absent-reservation')
          yield* admission.commit('absent-reservation').pipe(Effect.result)
          yield* Effect.all(
            [
              directory.fence({ conversationId: identity.id }),
              directory.fence({ conversationId: identity.id })
            ],
            { concurrency: 'unbounded' }
          )
          yield* Effect.all(
            [
              directory.completeCleanup(identity.id),
              directory.completeCleanup(identity.id)
            ],
            { concurrency: 'unbounded' }
          )
          const records = yield* db.select().from(auditEvents)
          const events = records
            .filter(
              (row) => row.targetId === identity.id || row.targetId === reserve.id
            )
            .map((row) => row.eventType)
          expect(
            events.filter((event) => event === 'assistant_conversation.created')
          ).toHaveLength(1)
          expect(
            events.filter((event) => event === 'assistant_conversation.policy_changed')
          ).toHaveLength(1)
          expect(
            events.filter((event) => event === 'assistant_attempt.reserved')
          ).toHaveLength(1)
          expect(
            events.filter((event) => event === 'assistant_attempt.committed')
          ).toHaveLength(1)
          expect(
            events.filter((event) => event === 'assistant_attempt.released')
          ).toHaveLength(1)
          expect(
            events.filter((event) => event === 'assistant_conversation.deleted')
          ).toHaveLength(2)
          expect(
            records.filter((row) => row.targetId === 'absent-reservation')
          ).toHaveLength(0)
        })
    )

    it.effect(
      'does not audit expired commits and counts only winning expiry reconciliation',
      () =>
        Effect.gen(function* () {
          const db = yield* Database
          const directory = yield* AssistantDirectory
          const admission = yield* AssistantAdmission
          const now = yield* Clock.currentTimeMillis
          yield* db.insert(user).values({
            id: 'audit-expiry-owner',
            email: 'audit-expiry@assistant.test',
            name: 'Audit expiry'
          })
          yield* db.insert(workspaces).values({
            id: 'audit-expired',
            slug: 'audit-expired',
            name: 'Audit expiry'
          })
          yield* directory.create({
            id: 'audit-expired-conversation',
            workspaceId: 'audit-expired',
            creatorUserId: 'audit-expiry-owner'
          })
          yield* admission.reserve({
            id: 'audit-expired-reservation',
            conversationId: 'audit-expired-conversation',
            workspaceId: 'audit-expired',
            userId: 'audit-expiry-owner',
            deadline: now + 1000,
            activeLimit: 3,
            rateLimit: 20
          })
          yield* TestClock.adjust('32 seconds')
          expect(
            (yield* admission.commit('audit-expired-reservation').pipe(Effect.result))
              ._tag
          ).toBe('Failure')
          const counts = yield* Effect.all(
            [admission.reconcileExpired(), admission.reconcileExpired()],
            { concurrency: 'unbounded' }
          )
          expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1)
          const records = yield* db
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.targetId, 'audit-expired-reservation'))
          expect(
            records.filter(
              (record) => record.eventType === 'assistant_attempt.committed'
            )
          ).toHaveLength(0)
          expect(
            records.filter(
              (record) => record.eventType === 'assistant_attempt.released'
            )
          ).toHaveLength(1)
        })
    )

    for (const testCase of [
      ...assistantDirectoryContractCases(expect),
      ...assistantLifecycleContractCases(expect)
    ]) {
      it.effect(testCase.name, () => testCase.assert)
    }
  })
})
