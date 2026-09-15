import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { TestClock } from 'effect/testing'
import { Clock, Effect, Result } from 'effect'
import { type ContractExpect } from '../governance/contract-expect.ts'
import { AssistantDirectory } from './directory.ts'
import { AssistantAdmission } from './admission.ts'

export function assistantDirectoryContractCases(expect: ContractExpect) {
  return [
    {
      name: 'retains run revocation across restoration without affecting other memberships or credentials',
      assert: Effect.gen(function* () {
        const directory = yield* AssistantDirectory
        for (const identity of [
          { id: 'run-target', workspaceId: 'workspace', creatorUserId: 'owner' },
          {
            id: 'run-other-workspace',
            workspaceId: 'concurrent',
            creatorUserId: 'owner'
          },
          { id: 'run-other-member', workspaceId: 'workspace', creatorUserId: 'other' }
        ]) {
          yield* directory.create(identity)
        }
        yield* directory.raisePolicy('run-target', ['webhook:list'])
        yield* directory.invalidateAccess({ conversationId: 'run-target' })
        expect((yield* directory.get('run-target'))?.runAccessRevision).toBe(0)
        for (const expectedRevision of [1, 2]) {
          yield* directory.invalidateAccess(
            { workspaceId: 'workspace', creatorUserId: 'owner' },
            { interruptRuns: true }
          )
          expect((yield* directory.get('run-target'))?.runAccessRevision).toBe(
            expectedRevision
          )
        }
        expect((yield* directory.get('run-other-workspace'))?.runAccessRevision).toBe(0)
        expect((yield* directory.get('run-other-member'))?.runAccessRevision).toBe(0)
        yield* directory.invalidateAccess(
          { workspaceId: 'workspace' },
          { interruptRuns: true }
        )
        expect((yield* directory.get('run-other-member'))?.runAccessRevision).toBe(1)
        expect((yield* directory.get('run-other-workspace'))?.runAccessRevision).toBe(0)
        // Leave later shared cases with their original live roster of conversations.
        for (const id of ['run-target', 'run-other-workspace', 'run-other-member']) {
          yield* directory.fence({ conversationId: id })
          yield* directory.completeCleanup(id)
        }
      })
    },
    {
      name: 'pages creator-owned metadata and keeps deletion fences after cleanup',
      assert: Effect.gen(function* () {
        const directory = yield* AssistantDirectory
        for (const id of ['directory-a', 'directory-b', 'directory-c']) {
          yield* directory.create({
            id,
            workspaceId: 'workspace',
            creatorUserId: 'owner'
          })
        }
        yield* directory.create({
          id: 'directory-other',
          workspaceId: 'workspace',
          creatorUserId: 'other'
        })
        const page = yield* directory.list({
          workspaceId: 'workspace',
          creatorUserId: 'owner',
          limit: 2
        })
        expect(page.items).toHaveLength(2)
        const next = yield* directory.list({
          workspaceId: 'workspace',
          creatorUserId: 'owner',
          limit: 2,
          cursor: page.nextCursor ?? undefined
        })
        expect(next.items).toHaveLength(1)
        yield* directory.fence({ creatorUserId: 'owner' })
        expect(
          (yield* directory.list({ workspaceId: 'workspace', creatorUserId: 'owner' }))
            .items
        ).toHaveLength(0)
        expect(yield* directory.pendingCleanup()).toHaveLength(3)
        yield* directory.completeCleanup('directory-a')
        expect((yield* directory.get('directory-a'))?.deletedAt !== null).toBe(true)
        expect(
          (yield* directory
            .create({
              id: 'directory-a',
              workspaceId: 'workspace',
              creatorUserId: 'owner'
            })
            .pipe(Effect.result))._tag
        ).toBe('Failure')
        expect(
          (yield* directory.list({ workspaceId: 'workspace', creatorUserId: 'other' }))
            .items
        ).toHaveLength(1)
      })
    },
    {
      name: 'unions concurrent evidence policies and refuses stale snapshot revisions',
      assert: Effect.gen(function* () {
        const directory = yield* AssistantDirectory
        yield* directory.create({
          id: 'policy',
          workspaceId: 'workspace',
          creatorUserId: 'owner'
        })
        yield* Effect.all(
          [
            directory.raisePolicy('policy', ['webhook:list']),
            directory.raisePolicy('policy', ['auditLog:read'])
          ],
          { concurrency: 'unbounded' }
        )
        const row = yield* directory.get('policy')
        expect(row?.requiredPermissions).toEqual(['auditLog:read', 'webhook:list'])
        expect(yield* directory.policyMatches('policy', 0)).toBe(false)
        const again = yield* directory.raisePolicy('policy', ['webhook:list'])
        expect(again.policyRevision === row?.policyRevision).toBe(true)
        yield* directory.fence({ conversationId: 'policy' })
        expect(yield* directory.policyMatches('policy', again.policyRevision)).toBe(
          false
        )
      })
    },
    {
      name: 'admits only three simultaneous Member answers and duplicates consume no slot',
      assert: Effect.gen(function* () {
        const directory = yield* AssistantDirectory
        const admission = yield* AssistantAdmission
        const now = yield* Clock.currentTimeMillis
        for (const id of ['quota-a', 'quota-b', 'quota-c', 'quota-d']) {
          yield* directory.create({
            id,
            workspaceId: 'concurrent',
            creatorUserId: 'owner'
          })
        }
        const inputs = ['quota-a', 'quota-b', 'quota-c', 'quota-d'].map((id) => ({
          id: `reservation-${id}`,
          conversationId: id,
          workspaceId: 'concurrent',
          userId: 'owner',
          deadline: now + 600_000,
          activeLimit: 3,
          rateLimit: 20
        }))
        const outcomes = yield* Effect.all(
          inputs.map((input) => admission.reserve(input).pipe(Effect.result)),
          { concurrency: 'unbounded' }
        )
        expect(outcomes.filter(Result.isSuccess)).toHaveLength(3)
        expect(outcomes.filter(Result.isFailure)).toHaveLength(1)
        const accepted = outcomes.find(Result.isSuccess)
        if (!accepted || !Result.isSuccess(accepted)) {
          return yield* Effect.fail(
            new CapabilityUnavailable({
              capability: 'assistant-contract',
              reason: 'No accepted reservation'
            })
          )
        }
        const input = inputs.find((candidate) => candidate.id === accepted.success.id)
        if (!input) {
          return yield* Effect.fail(
            new CapabilityUnavailable({
              capability: 'assistant-contract',
              reason: 'Missing fixture input'
            })
          )
        }
        expect((yield* admission.reserve(input)).id).toBe(accepted.success.id)
        yield* admission.commit(input.id)
        yield* admission.release(input.id)
        yield* admission.release(input.id)
        const refused = inputs.find((_, index) => {
          const outcome = outcomes[index]
          return outcome !== undefined && Result.isFailure(outcome)
        })
        if (!refused) {
          return yield* Effect.fail(
            new CapabilityUnavailable({
              capability: 'assistant-contract',
              reason: 'No refused reservation'
            })
          )
        }
        expect((yield* admission.reserve(refused)).id).toBe(refused.id)
        yield* directory.fence({ conversationId: refused.conversationId })
        expect((yield* admission.commit(refused.id).pipe(Effect.result))._tag).toBe(
          'Failure'
        )
      })
    },
    {
      name: 'expires ambiguous reservations without a browser returning',
      assert: Effect.gen(function* () {
        const directory = yield* AssistantDirectory
        const admission = yield* AssistantAdmission
        yield* directory.create({
          id: 'expiry',
          workspaceId: 'expiry',
          creatorUserId: 'owner'
        })
        const now = yield* Clock.currentTimeMillis
        const input = {
          id: 'expiry-first',
          conversationId: 'expiry',
          workspaceId: 'expiry',
          userId: 'owner',
          deadline: now + 1000,
          activeLimit: 1,
          rateLimit: 20
        }
        yield* admission.reserve(input)
        yield* TestClock.adjust('32 seconds')
        expect(yield* admission.reconcileExpired()).toBe(1)
        expect(yield* admission.reconcileExpired()).toBe(0)
        expect((yield* admission.commit(input.id).pipe(Effect.result))._tag).toBe(
          'Failure'
        )
        expect(
          (yield* admission.reserve({
            ...input,
            id: 'expiry-next',
            deadline: now + 60_000
          })).id
        ).toBe('expiry-next')
      })
    },
    {
      name: 'counts twenty accepted generations after release and restores the rolling allowance',
      assert: Effect.gen(function* () {
        const directory = yield* AssistantDirectory
        const admission = yield* AssistantAdmission
        yield* directory.create({
          id: 'rate',
          workspaceId: 'rate',
          creatorUserId: 'owner'
        })
        const now = yield* Clock.currentTimeMillis
        const input = {
          conversationId: 'rate',
          workspaceId: 'rate',
          userId: 'owner',
          deadline: now + 600_000,
          activeLimit: 3,
          rateLimit: 20
        }
        for (let index = 0; index < 20; index += 1) {
          const id = `rate-${index}`
          yield* admission.reserve({ ...input, id })
          yield* admission.commit(id)
          yield* admission.release(id)
        }
        const refusal = yield* admission
          .reserve({ ...input, id: 'rate-last' })
          .pipe(Effect.result)
        expect(refusal).toMatchObject({
          _tag: 'Failure',
          failure: {
            _tag: 'AssistantAdmissionRefused',
            reason: 'generation_rate_limit'
          }
        })
        yield* TestClock.adjust('61 seconds')
        expect((yield* admission.reserve({ ...input, id: 'rate-last' })).id).toBe(
          'rate-last'
        )
      })
    },
    {
      name: 'refuses invalid reservation budgets before consuming the Member allowance',
      assert: Effect.gen(function* () {
        const directory = yield* AssistantDirectory
        const admission = yield* AssistantAdmission
        const now = yield* Clock.currentTimeMillis
        yield* directory.create({
          id: 'invalid-budgets',
          workspaceId: 'workspace',
          creatorUserId: 'other'
        })
        const input = {
          id: 'validated-budget',
          conversationId: 'invalid-budgets',
          workspaceId: 'workspace',
          userId: 'other',
          deadline: now + 600_000,
          activeLimit: 1,
          rateLimit: 1
        }
        for (const invalid of [
          { deadline: now },
          { deadline: now - 1 },
          { activeLimit: 0 },
          { rateLimit: 0 }
        ]) {
          expect(
            yield* admission.reserve({ ...input, ...invalid }).pipe(Effect.result)
          ).toMatchObject({
            _tag: 'Failure',
            failure: { _tag: 'CapabilityUnavailable', reason: 'invalid_reservation' }
          })
        }
        expect((yield* admission.reserve(input)).id).toBe(input.id)
        yield* admission.release(input.id)
      })
    },
    {
      name: 'keeps reservation identity immutable and refuses missing, foreign, or deleted conversations',
      assert: Effect.gen(function* () {
        const directory = yield* AssistantDirectory
        const admission = yield* AssistantAdmission
        const now = yield* Clock.currentTimeMillis
        for (const identity of [
          { id: 'identity-original', workspaceId: 'workspace', creatorUserId: 'owner' },
          { id: 'identity-other', workspaceId: 'workspace', creatorUserId: 'other' },
          {
            id: 'identity-workspace',
            workspaceId: 'concurrent',
            creatorUserId: 'owner'
          }
        ]) {
          yield* directory.create(identity)
        }
        const input = {
          id: 'immutable-reservation',
          conversationId: 'identity-original',
          workspaceId: 'workspace',
          userId: 'owner',
          deadline: now + 600_000,
          activeLimit: 10,
          rateLimit: 100
        }
        const original = yield* admission.reserve(input)
        for (const changed of [
          { conversationId: 'identity-other', userId: 'other' },
          { conversationId: 'identity-workspace', workspaceId: 'concurrent' }
        ]) {
          expect(
            yield* admission.reserve({ ...input, ...changed }).pipe(Effect.result)
          ).toMatchObject({
            _tag: 'Failure',
            failure: {
              _tag: 'CapabilityUnavailable',
              reason: 'reservation_identity_conflict'
            }
          })
        }
        expect(yield* admission.reserve(input)).toEqual(original)
        for (const foreign of [
          { conversationId: 'missing-conversation' },
          { userId: 'other' },
          { workspaceId: 'concurrent' }
        ]) {
          expect(
            yield* admission
              .reserve({ ...input, ...foreign, id: 'foreign-reservation' })
              .pipe(Effect.result)
          ).toMatchObject({
            _tag: 'Failure',
            failure: { _tag: 'CapabilityUnavailable', reason: 'conversation_not_found' }
          })
        }
        yield* directory.fence({ conversationId: input.conversationId })
        expect(
          yield* admission
            .reserve({ ...input, id: 'after-deletion' })
            .pipe(Effect.result)
        ).toMatchObject({
          _tag: 'Failure',
          failure: { _tag: 'CapabilityUnavailable', reason: 'conversation_not_found' }
        })
        expect((yield* admission.commit(input.id).pipe(Effect.result))._tag).toBe(
          'Failure'
        )
      })
    },
    {
      name: 'refuses missing, released, and expired commits without reviving their reservation',
      assert: Effect.gen(function* () {
        const directory = yield* AssistantDirectory
        const admission = yield* AssistantAdmission
        const now = yield* Clock.currentTimeMillis
        yield* directory.create({
          id: 'commit-lifecycle',
          workspaceId: 'workspace',
          creatorUserId: 'other'
        })
        const input = {
          conversationId: 'commit-lifecycle',
          workspaceId: 'workspace',
          userId: 'other',
          deadline: now + 1000,
          activeLimit: 10,
          rateLimit: 100
        }
        expect(
          yield* admission.commit('never-reserved').pipe(Effect.result)
        ).toMatchObject({
          _tag: 'Failure',
          failure: { _tag: 'CapabilityUnavailable', reason: 'reservation_expired' }
        })
        yield* admission.release('never-reserved')
        yield* admission.reserve({ ...input, id: 'released-before-commit' })
        yield* admission.release('released-before-commit')
        expect(
          yield* admission.commit('released-before-commit').pipe(Effect.result)
        ).toMatchObject({
          _tag: 'Failure',
          failure: { _tag: 'CapabilityUnavailable', reason: 'reservation_expired' }
        })
        yield* admission.reserve({ ...input, id: 'deadline-before-commit' })
        yield* TestClock.adjust('1 second')
        expect(
          yield* admission.commit('deadline-before-commit').pipe(Effect.result)
        ).toMatchObject({
          _tag: 'Failure',
          failure: { _tag: 'CapabilityUnavailable', reason: 'reservation_expired' }
        })
        yield* admission.release('deadline-before-commit')
        expect(
          (yield* admission.reserve({
            ...input,
            id: 'replacement-after-refusal',
            deadline: now + 60_000
          })).committedAt
        ).toBe(null)
        yield* admission.commit('replacement-after-refusal')
        yield* admission.commit('replacement-after-refusal')
        yield* admission.release('replacement-after-refusal')
      })
    },
    {
      name: 'bounds expiry reconciliation and retains unexpired reservations across batches',
      assert: Effect.gen(function* () {
        const directory = yield* AssistantDirectory
        const admission = yield* AssistantAdmission
        // The Live contract retains earlier cases' rows; drain their expired work first.
        yield* admission
          .reconcileExpired()
          .pipe(Effect.repeat({ while: (count) => count > 0 }))
        const now = yield* Clock.currentTimeMillis
        yield* directory.create({
          id: 'bounded-expiry',
          workspaceId: 'workspace',
          creatorUserId: 'other'
        })
        const input = {
          conversationId: 'bounded-expiry',
          workspaceId: 'workspace',
          userId: 'other',
          deadline: now + 1000,
          activeLimit: 10,
          rateLimit: 100
        }
        for (const id of ['bounded-first', 'bounded-second', 'bounded-third']) {
          yield* admission.reserve({ ...input, id })
        }
        yield* admission.reserve({
          ...input,
          id: 'bounded-retained',
          deadline: now + 600_000
        })
        expect(yield* admission.reconcileExpired(2)).toBe(0)
        yield* TestClock.adjust('32 seconds')
        expect(yield* admission.reconcileExpired(2)).toBe(2)
        expect(yield* admission.reconcileExpired(2)).toBe(1)
        expect(yield* admission.reconcileExpired(2)).toBe(0)
        for (const id of ['bounded-first', 'bounded-second', 'bounded-third']) {
          expect((yield* admission.commit(id).pipe(Effect.result))._tag).toBe('Failure')
        }
        yield* admission.commit('bounded-retained')
        yield* admission.release('bounded-retained')
      })
    },
    {
      name: 'refuses stale policy targets and invalid cursors without mutating active conversations',
      assert: Effect.gen(function* () {
        const directory = yield* AssistantDirectory
        expect(yield* directory.get('absent-policy-target')).toBe(null)
        expect(
          (yield* directory
            .raisePolicy('absent-policy-target', ['webhook:list'])
            .pipe(Effect.result))._tag
        ).toBe('Failure')
        const row = yield* directory.create({
          id: 'policy-cleanup-guard',
          workspaceId: 'workspace',
          creatorUserId: 'other'
        })
        expect(
          yield* directory.list({
            workspaceId: 'workspace',
            creatorUserId: 'other',
            cursor: 'invalid-cursor'
          })
        ).toEqual({ items: [], nextCursor: null })
        yield* directory.completeCleanup(row.id)
        yield* directory.completeCleanup('absent-policy-target')
        expect(yield* directory.get(row.id)).toEqual(row)
        yield* directory.fence({ conversationId: 'absent-policy-target' })
        yield* directory.fence({ conversationId: row.id })
        expect(
          (yield* directory.raisePolicy(row.id, ['webhook:list']).pipe(Effect.result))
            ._tag
        ).toBe('Failure')
        expect((yield* directory.get(row.id))?.requiredPermissions).toEqual([])
      })
    },
    {
      name: 'invalidates only active conversations in the selected workspace',
      assert: Effect.gen(function* () {
        const directory = yield* AssistantDirectory
        const target = yield* directory.create({
          id: 'scope-target',
          workspaceId: 'workspace',
          creatorUserId: 'other'
        })
        const foreign = yield* directory.create({
          id: 'scope-foreign',
          workspaceId: 'concurrent',
          creatorUserId: 'other'
        })
        yield* directory.create({
          id: 'scope-deleted',
          workspaceId: 'workspace',
          creatorUserId: 'other'
        })
        yield* directory.fence({ conversationId: 'scope-deleted' })
        const deleted = yield* directory.get('scope-deleted')
        yield* directory.invalidateAccess({ workspaceId: 'workspace' })
        expect(yield* directory.policyMatches(target.id, target.policyRevision)).toBe(
          false
        )
        expect(yield* directory.get(foreign.id)).toEqual(foreign)
        expect(yield* directory.get('scope-deleted')).toEqual(deleted)
        yield* directory.fence({ workspaceId: 'workspace' })
        expect((yield* directory.get(target.id))?.deletedAt !== null).toBe(true)
        expect(yield* directory.get(foreign.id)).toEqual(foreign)
      })
    }
  ]
}
