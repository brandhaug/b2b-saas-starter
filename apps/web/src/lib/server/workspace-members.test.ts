import {
  SeedWorkspaceMembership,
  makeSeedRoster,
  type WorkspaceMembership
} from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import {
  testWorkspaceContext,
  type Actor,
  type WorkspaceContext
} from '@b2b-saas-starter/capabilities/workspace-context'
import {
  type Member,
  type Workspace,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { describe, expect, it } from 'vite-plus/test'
import { Effect, Layer, Ref, type Scope } from 'effect'

import { changeMemberRole, loadWorkspaceMembers } from './workspace-members'

/**
 * The member-management surface below its session gate. `changeMemberRole` is
 * exported as an effect taking only the role input, so what is testable without
 * a request or an auth runtime is exactly the behaviour: the `member:update`
 * gate and the hand-off to the membership capability (whose own contract tests
 * cover the plugin binding). The fixture roster is seeded per test, which the
 * app's own layer cannot do.
 *
 * Real clock on purpose: plain `it` + `Effect.runPromise`, not
 * `@effect/vitest`'s TestClock epoch.
 */

const workspace: Workspace = {
  id: 'wrk_test',
  slug: 'test-lab',
  name: 'Test Lab',
  planId: 'starter'
}

function actor(role: WorkspaceRole): Actor {
  return { userId: `usr_${role}`, role, systemRole: 'user' }
}

const OWNER = actor('owner')
const ADMIN = actor('admin')
const MEMBER = actor('member')

function memberOf(a: Actor): Member {
  return {
    id: a.userId,
    name: a.userId,
    email: `${a.userId}@example.com`,
    role: a.role,
    systemRole: 'user'
  }
}

type Harness = {
  readonly actor?: Actor | null
  readonly members?: ReadonlyArray<Member>
}

/**
 * Runs one effect against a fresh fixture. `roster` comes back so a test can
 * assert on what the run changed outside its return value.
 */
function run<A, E>(
  harness: Harness,
  body: () => Effect.Effect<A, E, Scope.Scope | WorkspaceContext | WorkspaceMembership>
): Promise<{ readonly result: A; readonly roster: ReadonlyArray<Member> }> {
  const members = harness.members ?? [memberOf(OWNER), memberOf(MEMBER)]
  return Effect.runPromise(
    Effect.gen(function* () {
      const roster = yield* makeSeedRoster(members)
      const layer = Layer.mergeAll(
        SeedWorkspaceMembership(roster, workspace),
        // `in` rather than `??`: a test that passes `actor: null` is asserting
        // what the guard does with no principal, not asking for the default.
        testWorkspaceContext(
          workspace,
          'actor' in harness ? (harness.actor ?? null) : OWNER
        )
      )
      const result = yield* Effect.scoped(body().pipe(Effect.provide(layer)))
      return { result, roster: yield* Ref.get(roster) }
    })
  )
}

/** Turns a typed failure into a value, so a denial is asserted not thrown. */
function outcome<A, E extends { readonly _tag: string; readonly reason?: string }, R>(
  effect: Effect.Effect<A, E, R>
) {
  return Effect.match(effect, {
    onSuccess: (value) => ({ tag: 'ok', value }),
    onFailure: (failure) => ({ tag: failure._tag, reason: failure.reason })
  })
}

describe('changeMemberRole', () => {
  it('lets an owner re-role another member', async () => {
    const { result, roster } = await run({}, () =>
      outcome(changeMemberRole({ userId: MEMBER.userId, role: 'admin' }))
    )
    expect(result).toEqual({
      tag: 'ok',
      value: expect.objectContaining({ id: MEMBER.userId, role: 'admin' })
    })
    expect(roster.find((candidate) => candidate.id === MEMBER.userId)?.role).toBe(
      'admin'
    )
  })

  it('lets an admin promote a member too — the matrix grants admin member:update', async () => {
    const { result } = await run({ actor: ADMIN }, () =>
      outcome(changeMemberRole({ userId: MEMBER.userId, role: 'member' }))
    )
    expect(result.tag).toBe('ok')
  })

  it('denies a member the change', async () => {
    const { result } = await run({ actor: MEMBER }, () =>
      outcome(changeMemberRole({ userId: OWNER.userId, role: 'member' }))
    )
    expect(result).toEqual({
      tag: 'AuthorizationDenied',
      reason: 'insufficient_permission'
    })
  })

  it('fails closed with no resolved actor', async () => {
    const { result } = await run({ actor: null }, () =>
      outcome(changeMemberRole({ userId: MEMBER.userId, role: 'admin' }))
    )
    expect(result).toEqual({ tag: 'AuthorizationDenied', reason: 'no_principal' })
  })
})

/**
 * The loader seam, driven against the Seed layer: `runWorkspaceCapabilities`
 * resolves `cloudflare:workers` to the inert shim under Vitest (vite.config.ts),
 * so `DB` is undefined and the in-memory fixture answers. Both users below are
 * seed members of `starter-lab` — `usr_demo` owns it, `usr_dev` is a plain
 * member.
 */
describe('loadWorkspaceMembers', () => {
  it('lists the roster with the viewer role for an owner', async () => {
    const payload = await loadWorkspaceMembers({
      workspaceSlug: 'starter-lab',
      userId: 'usr_demo'
    })
    expect(payload.viewer).toEqual({ role: 'owner' })
    expect(payload.unreadCount).toBeTypeOf('number')
    expect(payload.members.length).toBeGreaterThan(0)
    expect(payload.members.map((member) => member.id)).toContain('usr_dev')
  })

  it('shows a plain member the roster too — membership itself entitles the read', async () => {
    const payload = await loadWorkspaceMembers({
      workspaceSlug: 'starter-lab',
      userId: 'usr_dev'
    })
    expect(payload.viewer).toEqual({ role: 'member' })
    expect(payload.members.length).toBeGreaterThan(0)
  })
})
