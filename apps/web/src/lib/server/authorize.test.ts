import {
  testWorkspaceContext,
  type Actor
} from '@b2b-saas-starter/capabilities/workspace-context'
import {
  type Workspace,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { Effect, type Scope } from 'effect'
import { describe, expect, it } from '@effect/vitest'

import { requireWorkspacePermission } from './authorize'

const workspace: Workspace = {
  id: 'wrk_test',
  slug: 'test-lab',
  name: 'Test Lab',
  planId: 'starter'
}

function actor(role: WorkspaceRole): Actor {
  return { userId: `usr_${role}`, role, systemRole: 'user' }
}

/**
 * `requirePermission` annotates the request's wide event on denial, so it needs
 * a Scope. Server functions get one from `runWorkspaceCapabilities`; the
 * TestContext behind `it.effect` supplies one here.
 */
function decide(
  actorOrNull: Actor | null,
  permission: Parameters<typeof requireWorkspacePermission>[0]
): Effect.Effect<string, never, Scope.Scope> {
  return requireWorkspacePermission(permission).pipe(
    Effect.as('allowed'),
    Effect.catchTag('AuthorizationDenied', (error) => Effect.succeed(error.reason)),
    Effect.provide(testWorkspaceContext(workspace, actorOrNull))
  )
}

describe('requireWorkspacePermission', () => {
  it.effect('lets an owner create an API token', () =>
    Effect.gen(function* () {
      expect(yield* decide(actor('owner'), { apiToken: ['create'] })).toBe('allowed')
    })
  )

  it.effect('lets an admin create an API token', () =>
    Effect.gen(function* () {
      expect(yield* decide(actor('admin'), { apiToken: ['create'] })).toBe('allowed')
    })
  )

  it.effect('refuses a member the token, webhook and audit-log surfaces', () =>
    Effect.gen(function* () {
      const member = actor('member')
      expect(yield* decide(member, { apiToken: ['create'] })).toBe(
        'insufficient_permission'
      )
      expect(yield* decide(member, { webhook: ['create'] })).toBe(
        'insufficient_permission'
      )
      expect(yield* decide(member, { auditLog: ['read'] })).toBe(
        'insufficient_permission'
      )
    })
  )

  it.effect('refuses a member member-management actions', () =>
    Effect.gen(function* () {
      expect(yield* decide(actor('member'), { member: ['create'] })).toBe(
        'insufficient_permission'
      )
      expect(yield* decide(actor('member'), { member: ['delete'] })).toBe(
        'insufficient_permission'
      )
    })
  )

  it.effect('still lets a member read the workspace content', () =>
    Effect.gen(function* () {
      expect(yield* decide(actor('member'), { notification: ['read'] })).toBe('allowed')
      expect(yield* decide(actor('member'), { ac: ['read'] })).toBe('allowed')
    })
  )

  it.effect('fails closed when the context resolved no actor', () =>
    Effect.gen(function* () {
      // A trusted read (the public showcase loader) omits the actor entirely.
      // Reaching the guard without one means nothing was proved, so it denies.
      expect(yield* decide(null, { notification: ['read'] })).toBe('no_principal')
    })
  )

  it.effect('grants a system admin nothing inside the workspace', () =>
    Effect.gen(function* () {
      // `user.role === 'admin'` is a separate axis. A system admin who is only a
      // workspace member gets the member's answer, so the bypass stays absent
      // from the audit log because it does not exist.
      const systemAdminMember: Actor = {
        userId: 'usr_sysadmin',
        role: 'member',
        systemRole: 'admin'
      }
      expect(yield* decide(systemAdminMember, { apiToken: ['create'] })).toBe(
        'insufficient_permission'
      )
    })
  )
})
