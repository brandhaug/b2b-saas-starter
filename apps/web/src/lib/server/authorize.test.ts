// oxlint-disable-next-line import/no-unassigned-import -- Installs the explicit authenticated-session test fixture.
import '@/test/qualified-session'
import { vi } from 'vite-plus/test'
import { fixtureSession } from '@/test/fixture-session'
import { SeedStrongAuthentication } from '@b2b-saas-starter/capabilities/governance/strong-authentication'
import {
  testWorkspaceContext,
  type Actor
} from '@b2b-saas-starter/capabilities/workspace-context'
import {
  type Workspace,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { Effect, Layer } from 'effect'
import { SeedLayer } from '@b2b-saas-starter/capabilities/layers'
import { seedSystemUsers } from '@b2b-saas-starter/capabilities/seed-fixture'
import { SeedWorkspaceSuspension } from '@b2b-saas-starter/capabilities/governance/workspace-suspension.seed'
import { WorkspaceSuspensionService } from '@b2b-saas-starter/capabilities/governance/workspace-suspension'
import { describe, expect, it } from '@effect/vitest'

import { permitted, requireWorkspacePermission } from './authorize'

vi.mock('./auth', () => ({
  requireRequestSession: async () => fixtureSession({ userId: 'usr_owner' })
}))

const workspace: Workspace = {
  id: 'wrk_test',
  slug: 'test-lab',
  name: 'Test Lab',
  planId: 'starter'
}

function actor(role: WorkspaceRole): Actor {
  return { userId: `usr_${role}`, role, systemRole: 'user' }
}

const suspensionLayer = SeedWorkspaceSuspension({
  workspace,
  systemUsers: seedSystemUsers
}).pipe(Layer.provide(SeedLayer), Layer.merge(SeedStrongAuthentication()))

/**
 * `requirePermission` annotates the request's wide event on denial, so it needs
 * a Scope. Server functions get one from `runWorkspaceCapabilities`; the
 * TestContext behind `it.effect` supplies one here.
 */
function decide(
  actorOrNull: Actor | null,
  permission: Parameters<typeof requireWorkspacePermission>[0]
) {
  return requireWorkspacePermission(permission).pipe(
    Effect.as('allowed'),
    Effect.catchTag('AuthorizationDenied', (error) => Effect.succeed(error.reason)),
    Effect.provide(testWorkspaceContext(workspace, actorOrNull)),
    Effect.provide(suspensionLayer)
  )
}

describe('requireWorkspacePermission', () => {
  it.effect(
    'an existing session loses product access while permitted recovery remains available',
    () =>
      Effect.gen(function* () {
        yield* requireWorkspacePermission({ apiToken: ['create'] })
        const suspension = yield* WorkspaceSuspensionService
        yield* suspension.transition({
          workspaceId: workspace.id,
          action: 'suspend',
          actor: { userId: 'usr_demo' },
          internalReason: 'Private operator reason',
          customerExplanation: 'Please contact support.'
        })
        expect(
          (yield* Effect.flip(requireWorkspacePermission({ apiToken: ['create'] })))
            ._tag
        ).toBe('WorkspaceSuspended')
        expect(
          (yield* Effect.flip(requireWorkspacePermission({ notification: ['read'] })))
            ._tag
        ).toBe('WorkspaceSuspended')
        expect(yield* permitted({ notification: ['read'] })).toBe(false)
        expect(yield* permitted({ apiToken: ['list'], webhook: ['list'] })).toBe(false)
        yield* requireWorkspacePermission({ apiToken: ['revoke'] })
        yield* requireWorkspacePermission({ sso: ['update'] })
        yield* requireWorkspacePermission(
          { organization: ['update'] },
          'billing_recovery'
        )
        expect(
          (yield* Effect.flip(requireWorkspacePermission({ organization: ['delete'] })))
            ._tag
        ).toBe('WorkspaceSuspended')
        yield* suspension.transition({
          workspaceId: workspace.id,
          action: 'unsuspend',
          actor: { userId: 'usr_demo' },
          internalReason: 'Review complete'
        })
        yield* requireWorkspacePermission({ notification: ['read'] })
      }).pipe(
        Effect.provide(testWorkspaceContext(workspace, actor('owner'))),
        Effect.provide(suspensionLayer)
      )
  )

  it.effect(
    'suspension recovery does not grant members billing or credential rights, or admins owner-only SSO repair',
    () =>
      Effect.gen(function* () {
        const suspension = yield* WorkspaceSuspensionService
        yield* suspension.transition({
          workspaceId: workspace.id,
          action: 'suspend',
          actor: { userId: 'usr_demo' },
          internalReason: 'Private operator reason',
          customerExplanation: 'Please contact support.'
        })
        const memberContext = testWorkspaceContext(workspace, actor('member'))
        expect(
          (yield* Effect.flip(
            requireWorkspacePermission({ apiToken: ['revoke'] }).pipe(
              Effect.provide(memberContext)
            )
          ))._tag
        ).toBe('AuthorizationDenied')
        expect(
          (yield* Effect.flip(
            requireWorkspacePermission(
              { organization: ['update'] },
              'billing_recovery'
            ).pipe(Effect.provide(memberContext))
          ))._tag
        ).toBe('AuthorizationDenied')
        expect(
          (yield* Effect.flip(
            requireWorkspacePermission({ sso: ['update'] }).pipe(
              Effect.provide(testWorkspaceContext(workspace, actor('admin')))
            )
          ))._tag
        ).toBe('WorkspaceSuspended')
      }).pipe(Effect.provide(suspensionLayer))
  )
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
