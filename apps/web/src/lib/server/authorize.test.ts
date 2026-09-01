import {
  testWorkspaceContext,
  type Actor
} from '@b2b-saas-starter/capabilities/workspace-context'
import {
  type Workspace,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { Effect } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

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
 * a Scope. Server functions get one from `runWorkspaceCapabilities`; tests
 * supply their own with `Effect.scoped`.
 */
function decide(
  actorOrNull: Actor | null,
  permission: Parameters<typeof requireWorkspacePermission>[0]
): Promise<string> {
  return Effect.runPromise(
    Effect.scoped(requireWorkspacePermission(permission)).pipe(
      Effect.as('allowed'),
      Effect.catchTag('AuthorizationDenied', (error) => Effect.succeed(error.reason)),
      Effect.provide(testWorkspaceContext(workspace, actorOrNull))
    )
  )
}

describe('requireWorkspacePermission', () => {
  it('lets an owner create an API token', async () => {
    expect(await decide(actor('owner'), { apiToken: ['create'] })).toBe('allowed')
  })

  it('lets an admin create an API token', async () => {
    expect(await decide(actor('admin'), { apiToken: ['create'] })).toBe('allowed')
  })

  it('refuses a member the token, webhook and audit-log surfaces', async () => {
    const member = actor('member')
    expect(await decide(member, { apiToken: ['create'] })).toBe(
      'insufficient_permission'
    )
    expect(await decide(member, { webhook: ['create'] })).toBe(
      'insufficient_permission'
    )
    expect(await decide(member, { auditLog: ['read'] })).toBe('insufficient_permission')
  })

  it('refuses a member member-management actions', async () => {
    expect(await decide(actor('member'), { member: ['create'] })).toBe(
      'insufficient_permission'
    )
    expect(await decide(actor('member'), { member: ['delete'] })).toBe(
      'insufficient_permission'
    )
  })

  it('still lets a member read the workspace content', async () => {
    expect(await decide(actor('member'), { notification: ['read'] })).toBe('allowed')
    expect(await decide(actor('member'), { ac: ['read'] })).toBe('allowed')
  })

  it('fails closed when the context resolved no actor', async () => {
    // A trusted read (the public showcase loader) omits the actor entirely.
    // Reaching the guard without one means nothing was proved, so it denies.
    expect(await decide(null, { notification: ['read'] })).toBe('no_principal')
  })

  it('grants a system admin nothing inside the workspace', async () => {
    // `user.role === 'admin'` is a separate axis. A system admin who is only a
    // workspace member gets the member's answer, so the bypass stays absent
    // from the audit log because it does not exist.
    const systemAdminMember: Actor = {
      userId: 'usr_sysadmin',
      role: 'member',
      systemRole: 'admin'
    }
    expect(await decide(systemAdminMember, { apiToken: ['create'] })).toBe(
      'insufficient_permission'
    )
  })
})
