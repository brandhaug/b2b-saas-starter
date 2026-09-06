import { Effect } from 'effect'
import { TestClock } from 'effect/testing'
import { type ContractExpect } from '../governance/contract-expect.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { failureTag } from '../internal/failure-tag.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import {
  ApiTokenRegistry,
  MAX_TOKEN_OVERLAP_SECONDS,
  type CreateApiTokenInput,
  type ReplaceApiTokenPayload
} from './api-token-registry.ts'

const START = 1_800_000_000_000
const START_ISO = '2027-01-15T08:00:00.000Z'
const MINUTE = '2027-01-15T08:01:00.000Z'
const HOUR = '2027-01-15T09:00:00.000Z'

export function apiTokenRegistryContractCases(expect: ContractExpect) {
  return [
    {
      name: 'verifies a created credential until the exact expiry instant',
      assert: Effect.gen(function* () {
        yield* TestClock.setTime(START)
        const registry = yield* ApiTokenRegistry
        const ctx = yield* WorkspaceContext
        const created = yield* registry.create({
          name: 'expiry',
          scopes: ['read'],
          expiresAt: MINUTE
        })
        yield* TestClock.adjust(59_999)
        expect(yield* registry.verifyBearerToken(created.token)).toMatchObject({
          id: created.id,
          workspaceId: ctx.workspace.id,
          scopes: ['read']
        })
        yield* TestClock.adjust(1)
        expect(
          failureTag(yield* Effect.exit(registry.verifyBearerToken(created.token)))
        ).toBe('AuthorizationDenied')
        expect(
          (yield* registry.list).find((token) => token.id === created.id)?.expiresAt
        ).toBe(MINUTE)
      })
    },
    {
      name: 'immediate retirement narrows scopes, preserves identity and expiry, and links the lifecycle',
      assert: Effect.gen(function* () {
        yield* TestClock.setTime(START)
        const registry = yield* ApiTokenRegistry
        const ctx = yield* WorkspaceContext
        const audit = yield* AuditEventLog
        const original = yield* registry.create({
          name: 'automation',
          scopes: ['read', 'write'],
          expiresAt: HOUR
        })
        const replacement = yield* registry.replace({
          tokenId: original.id,
          scopes: ['read'],
          overlapSeconds: 0
        })
        expect(replacement).toMatchObject({
          name: original.name,
          scopes: ['read'],
          expiresAt: HOUR,
          previousTokenId: original.id,
          previousTokenExpiresAt: START_ISO
        })
        expect(replacement.token === original.token).toBe(false)
        expect(yield* registry.verifyBearerToken(replacement.token)).toMatchObject({
          workspaceId: ctx.workspace.id,
          scopes: ['read']
        })
        expect(
          failureTag(yield* Effect.exit(registry.verifyBearerToken(original.token)))
        ).toBe('AuthorizationDenied')
        const listed = yield* registry.list
        expect(listed.find((token) => token.id === original.id)).toMatchObject({
          replacedByTokenId: replacement.id,
          expiresAt: START_ISO
        })
        expect(
          new Set(listed.flatMap((token) => Object.values(token))).has(
            replacement.token
          )
        ).toBe(false)
        expect(
          (yield* audit.list({ eventType: 'api_token.replaced' })).items.some(
            (event) => event.targetId === replacement.id
          )
        ).toBe(true)
      })
    },
    {
      name: 'keeps both credentials usable during overlap and retires the old one exactly on time',
      assert: Effect.gen(function* () {
        yield* TestClock.setTime(START)
        const registry = yield* ApiTokenRegistry
        const original = yield* registry.create({ name: 'overlap', scopes: ['read'] })
        const replacement = yield* registry.replace({
          tokenId: original.id,
          scopes: ['read'],
          overlapSeconds: 60
        })
        expect(replacement.expiresAt).toBe(null)
        expect(replacement.previousTokenExpiresAt).toBe(MINUTE)
        yield* TestClock.adjust(59_999)
        yield* registry.verifyBearerToken(original.token)
        yield* registry.verifyBearerToken(replacement.token)
        yield* TestClock.adjust(1)
        expect(
          failureTag(yield* Effect.exit(registry.verifyBearerToken(original.token)))
        ).toBe('AuthorizationDenied')
        yield* registry.verifyBearerToken(replacement.token)
      })
    },
    {
      name: 'chained replacements preserve ancestor deadlines and retire each credential independently',
      assert: Effect.gen(function* () {
        yield* TestClock.setTime(START)
        const registry = yield* ApiTokenRegistry
        const original = yield* registry.create({
          name: 'rotation chain',
          scopes: ['read', 'write'],
          expiresAt: HOUR
        })
        const first = yield* registry.replace({
          tokenId: original.id,
          scopes: ['read'],
          overlapSeconds: 60
        })
        yield* TestClock.adjust(30_000)
        const second = yield* registry.replace({
          tokenId: first.id,
          scopes: ['read'],
          overlapSeconds: 60
        })
        expect(second.expiresAt).toBe(HOUR)
        expect(
          (yield* registry.list).find((token) => token.id === original.id)
        ).toMatchObject({
          expiresAt: MINUTE,
          replacedByTokenId: first.id
        })
        yield* registry.verifyBearerToken(original.token)
        yield* registry.verifyBearerToken(first.token)
        yield* registry.verifyBearerToken(second.token)
        yield* TestClock.adjust(30_000)
        expect(
          failureTag(yield* Effect.exit(registry.verifyBearerToken(original.token)))
        ).toBe('AuthorizationDenied')
        yield* registry.verifyBearerToken(first.token)
        yield* registry.revoke({ tokenId: first.id })
        expect(
          failureTag(yield* Effect.exit(registry.verifyBearerToken(first.token)))
        ).toBe('AuthorizationDenied')
        yield* registry.verifyBearerToken(second.token)
      })
    },
    {
      name: 'overlap never extends an earlier original expiry and replacement may shorten it',
      assert: Effect.gen(function* () {
        yield* TestClock.setTime(START)
        const registry = yield* ApiTokenRegistry
        const original = yield* registry.create({
          name: 'short overlap',
          scopes: ['read'],
          expiresAt: MINUTE
        })
        const replacement = yield* registry.replace({
          tokenId: original.id,
          scopes: ['read'],
          overlapSeconds: MAX_TOKEN_OVERLAP_SECONDS
        })
        expect(replacement.previousTokenExpiresAt).toBe(MINUTE)
        expect(replacement.expiresAt).toBe(MINUTE)
        yield* TestClock.adjust(60_000)
        expect(
          failureTag(yield* Effect.exit(registry.verifyBearerToken(original.token)))
        ).toBe('AuthorizationDenied')
        expect(
          failureTag(yield* Effect.exit(registry.verifyBearerToken(replacement.token)))
        ).toBe('AuthorizationDenied')
        yield* TestClock.setTime(START)
        const second = yield* registry.create({
          name: 'shorter replacement',
          scopes: ['read'],
          expiresAt: HOUR
        })
        expect(
          (yield* registry.replace({
            tokenId: second.id,
            scopes: ['read'],
            overlapSeconds: 0,
            expiresAt: MINUTE
          })).expiresAt
        ).toBe(MINUTE)
      })
    },
    {
      name: 'rejects scope escalation, extended expiry, malformed expiry and invalid overlap without changing the token',
      assert: Effect.gen(function* () {
        yield* TestClock.setTime(START)
        const registry = yield* ApiTokenRegistry
        const original = yield* registry.create({
          name: 'invalid replacements',
          scopes: ['read'],
          expiresAt: MINUTE
        })
        const invalid: ReadonlyArray<ReplaceApiTokenPayload> = [
          { scopes: ['read', 'write'], overlapSeconds: 0 },
          { scopes: [], overlapSeconds: 0 },
          { scopes: ['read', 'read'], overlapSeconds: 0 },
          { scopes: ['read'], overlapSeconds: -1 },
          { scopes: ['read'], overlapSeconds: 0.5 },
          { scopes: ['read'], overlapSeconds: MAX_TOKEN_OVERLAP_SECONDS + 1 },
          { scopes: ['read'], overlapSeconds: Number.NaN },
          { scopes: ['read'], overlapSeconds: 0, expiresAt: HOUR },
          { scopes: ['read'], overlapSeconds: 0, expiresAt: START_ISO },
          { scopes: ['read'], overlapSeconds: 0, expiresAt: 'not a date' }
        ]
        for (const input of invalid) {
          expect(
            failureTag(
              yield* Effect.exit(registry.replace({ tokenId: original.id, ...input }))
            )
          ).toBe('InvalidApiTokenInput')
        }
        yield* registry.verifyBearerToken(original.token)
        expect(
          (yield* registry.list).find((token) => token.id === original.id)
        ).toMatchObject({ expiresAt: MINUTE, replacedByTokenId: null })
      })
    },
    {
      name: 'rejects invalid creation before storing a token',
      assert: Effect.gen(function* () {
        yield* TestClock.setTime(START)
        const registry = yield* ApiTokenRegistry
        const before = yield* registry.list
        const invalid: ReadonlyArray<CreateApiTokenInput> = [
          { name: '', scopes: ['read'] },
          { name: 'empty scopes', scopes: [] },
          { name: 'duplicates', scopes: ['read', 'read'] },
          { name: 'malformed expiry', scopes: ['read'], expiresAt: 'tomorrow' },
          { name: 'expired', scopes: ['read'], expiresAt: START_ISO },
          {
            name: 'invalid calendar date',
            scopes: ['read'],
            expiresAt: '2027-02-30T00:00:00.000Z'
          }
        ]
        for (const input of invalid) {
          expect(failureTag(yield* Effect.exit(registry.create(input)))).toBe(
            'InvalidApiTokenInput'
          )
        }
        expect(yield* registry.list).toEqual(before)
      })
    },
    {
      name: 'replacement remains available at the plan limit and consumes one credential slot',
      assert: Effect.gen(function* () {
        yield* TestClock.setTime(START)
        const registry = yield* ApiTokenRegistry
        const ctx = yield* WorkspaceContext
        yield* Effect.gen(function* () {
          for (const token of yield* registry.list) {
            yield* registry.revoke({ tokenId: token.id })
          }
          const first = yield* registry.create({ name: 'slot one', scopes: ['read'] })
          const second = yield* registry.create({ name: 'slot two', scopes: ['read'] })
          expect(
            failureTag(
              yield* Effect.exit(
                registry.create({ name: 'over cap', scopes: ['read'] })
              )
            )
          ).toBe('PlanLimitExceeded')
          const replacement = yield* registry.replace({
            tokenId: first.id,
            scopes: ['read'],
            overlapSeconds: 60
          })
          yield* registry.verifyBearerToken(first.token)
          yield* registry.verifyBearerToken(replacement.token)
          expect(
            failureTag(
              yield* Effect.exit(
                registry.create({ name: 'still capped', scopes: ['read'] })
              )
            )
          ).toBe('PlanLimitExceeded')
          yield* registry.revoke({ tokenId: second.id })
          const available = yield* registry.create({
            name: 'free slot',
            scopes: ['read']
          })
          yield* registry.verifyBearerToken(available.token)
        }).pipe(
          Effect.provideService(WorkspaceContext, {
            ...ctx,
            workspace: {
              ...ctx.workspace,
              id: 'wrk_capped',
              slug: 'capped-lab',
              planId: 'starter'
            }
          })
        )
      })
    },
    {
      name: 'cannot replace revoked, expired, already replaced, unknown or foreign tokens',
      assert: Effect.gen(function* () {
        yield* TestClock.setTime(START)
        const registry = yield* ApiTokenRegistry
        const ctx = yield* WorkspaceContext
        const revoked = yield* registry.create({ name: 'revoked', scopes: ['read'] })
        yield* registry.revoke({ tokenId: revoked.id })
        const expired = yield* registry.create({
          name: 'expired',
          scopes: ['read'],
          expiresAt: MINUTE
        })
        const replaced = yield* registry.create({ name: 'replaced', scopes: ['read'] })
        yield* registry.replace({
          tokenId: replaced.id,
          scopes: ['read'],
          overlapSeconds: 60
        })
        yield* TestClock.adjust(60_000)
        for (const tokenId of [revoked.id, expired.id, replaced.id, 'tok_unknown']) {
          expect(
            failureTag(
              yield* Effect.exit(
                registry.replace({ tokenId, scopes: ['read'], overlapSeconds: 0 })
              )
            )
          ).toBe('ApiTokenNotRotatable')
        }
        const foreign = yield* registry.create({ name: 'foreign', scopes: ['read'] })
        const foreignResult = yield* Effect.exit(
          registry
            .replace({ tokenId: foreign.id, scopes: ['read'], overlapSeconds: 0 })
            .pipe(
              Effect.provideService(WorkspaceContext, {
                ...ctx,
                workspace: { ...ctx.workspace, id: 'wrk_other', slug: 'other-lab' }
              })
            )
        )
        expect(failureTag(foreignResult)).toBe('ApiTokenNotRotatable')
        yield* registry.verifyBearerToken(foreign.token)
      })
    }
  ]
}
