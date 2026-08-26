import {
  SeedApiTokenRegistry,
  type ApiToken
} from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { SeedWebhookPublisher } from '@b2b-saas-starter/capabilities/developer-platform/webhook-publisher'
import { SeedAuditEventLog } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import {
  testWorkspaceContext,
  type Actor
} from '@b2b-saas-starter/capabilities/workspace-context'
import {
  type Workspace,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { describe, expect, it } from 'vitest'
import { Effect, Layer } from 'effect'

import { loadWorkspaceApiTokens, revokeApiToken } from './api-tokens'

/**
 * The API-token management surface below its session gate. `revokeApiToken` is
 * exported as an effect taking only the revocation input, so what is testable
 * without a request or an auth runtime is exactly the behaviour: the
 * `apiToken:revoke` gate and the hand-off to the registry.
 *
 * Real clock on purpose: plain `it` + `Effect.runPromise`, not
 * `@effect/vitest`'s TestClock epoch.
 */

const workspace: Workspace = {
  // The Seed adapters scope fixture rows to the seed workspace, so this test
  // context must use its id.
  id: 'wrk_starter',
  slug: 'test-lab',
  name: 'Test Lab',
  planId: 'starter'
}

function actor(role: WorkspaceRole): Actor {
  return { userId: `usr_${role}`, role, systemRole: 'user' }
}

const OWNER = actor('owner')
const MEMBER = actor('member')

const seedTokens: readonly ApiToken[] = [
  {
    id: 'tok_1',
    name: 'Local client',
    prefix: 'bsk_seed',
    scopes: ['read'],
    lastUsedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z'
  }
]

/** Turns a typed failure into a value, so a denial is asserted not thrown. */
function outcome<A, E extends { readonly _tag: string; readonly reason?: string }, R>(
  effect: Effect.Effect<A, E, R>
) {
  return Effect.match(effect, {
    onSuccess: (value) => ({ tag: 'ok', value }),
    onFailure: (failure) => ({ tag: failure._tag, reason: failure.reason })
  })
}

describe('revokeApiToken', () => {
  const layer = Layer.mergeAll(
    SeedApiTokenRegistry(seedTokens).pipe(
      Layer.provide(SeedAuditEventLog([])),
      Layer.provide(SeedWebhookPublisher)
    ),
    testWorkspaceContext(workspace, OWNER)
  )

  it('lets an actor with apiToken:revoke revoke', async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        outcome(revokeApiToken({ tokenId: 'tok_1' })).pipe(Effect.provide(layer))
      )
    )
    expect(result).toEqual({ tag: 'ok', value: true })
  })

  it('denies a plain member — apiToken:revoke is withheld from member', async () => {
    const memberLayer = Layer.mergeAll(
      SeedApiTokenRegistry(seedTokens).pipe(
        Layer.provide(SeedAuditEventLog([])),
        Layer.provide(SeedWebhookPublisher)
      ),
      testWorkspaceContext(workspace, MEMBER)
    )
    const result = await Effect.runPromise(
      Effect.scoped(
        outcome(revokeApiToken({ tokenId: 'tok_1' })).pipe(Effect.provide(memberLayer))
      )
    )
    expect(result).toEqual({
      tag: 'AuthorizationDenied',
      reason: 'insufficient_permission'
    })
  })

  it('fails closed with no resolved actor', async () => {
    const anonymousLayer = Layer.mergeAll(
      SeedApiTokenRegistry(seedTokens).pipe(
        Layer.provide(SeedAuditEventLog([])),
        Layer.provide(SeedWebhookPublisher)
      ),
      testWorkspaceContext(workspace, null)
    )
    const result = await Effect.runPromise(
      Effect.scoped(
        outcome(revokeApiToken({ tokenId: 'tok_1' })).pipe(
          Effect.provide(anonymousLayer)
        )
      )
    )
    expect(result).toEqual({ tag: 'AuthorizationDenied', reason: 'no_principal' })
  })
})

/**
 * The loader seam, driven against the app's own Seed layer: `DB` is undefined
 * under Vitest (vite.config.ts), so `runWorkspaceCapabilities` answers from
 * the in-memory fixture. Both users below are seed members of `starter-lab` —
 * `usr_demo` owns it, `usr_dev` is a plain member.
 */
describe('loadWorkspaceApiTokens', () => {
  it('lists tokens with the viewer role for an owner', async () => {
    const payload = await loadWorkspaceApiTokens({
      workspaceSlug: 'starter-lab',
      userId: 'usr_demo'
    })
    expect(payload.viewer).toEqual({ role: 'owner' })
    expect(payload.unreadCount).toBeTypeOf('number')
    // The seed fixtures carry two bearer credentials.
    expect(payload.tokens.length).toBeGreaterThan(0)
  })

  it('denies a plain member — reading tokens is itself gated', async () => {
    await expect(
      loadWorkspaceApiTokens({ workspaceSlug: 'starter-lab', userId: 'usr_dev' })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
  })
})
