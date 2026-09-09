import { describe, expect, it, vi, beforeEach } from 'vite-plus/test'
import { Effect } from 'effect'
import {
  StrongAuthentication,
  StrongAuthenticationRequired
} from '@b2b-saas-starter/capabilities/governance/strong-authentication'
import {
  AccountLifecycle,
  type AccountDeletionPlan
} from '@b2b-saas-starter/capabilities/governance/account-lifecycle'
import { type WorkspaceRole } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { fixtureSession } from '@/test/fixture-session'
import { deleteAccountHandler } from './account-delete.effects'
import { strongAuthenticationHttpResponse } from './strong-authentication-http'

const deletion = vi.hoisted(() => ({
  systemAdmin: false,
  owner: false,
  workspaceAdmin: false,
  impersonated: false,
  executed: false
}))
const evidence = vi.hoisted(() => ({
  qualified: false,
  recovering: false,
  hasFactors: false,
  passwordVerified: false
}))
vi.mock('../capabilities', () => ({
  runCapabilities: <A, E>(
    effect: Effect.Effect<A, E, StrongAuthentication | AccountLifecycle>
  ) =>
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- this mock implements runCapabilities, the handlers' Promise-returning runtime boundary
    Effect.runPromise(
      effect.pipe(
        Effect.provideService(StrongAuthentication, {
          status: () => Effect.succeed(evidence),
          require: () => {
            if (evidence.qualified) {
              return Effect.void
            }
            return Effect.fail(new StrongAuthenticationRequired())
          }
        }),
        Effect.provideService(AccountLifecycle, {
          planDeletion: () => Effect.succeed(planForDeletion()),
          prepareDeletion: () => Effect.succeed(planForDeletion()),
          recordDeleted: () => Effect.void,
          deleteAccount: () =>
            Effect.sync(() => {
              deletion.executed = true
              return planForDeletion()
            })
        })
      )
    )
}))
vi.mock('./account-binding', () => ({ webAccountLifecycleBinding: {} }))
vi.mock('./security-evidence-sink', () => ({
  makeSecurityEvidenceSink: () => undefined
}))
vi.mock('./auth', () => ({
  requireRequestSession: async () => {
    let impersonatedBy = null
    if (deletion.impersonated) {
      impersonatedBy = 'usr_operator'
    }
    const session = fixtureSession({ userId: 'usr_actor', impersonatedBy })
    if (deletion.systemAdmin) {
      return { ...session, user: { ...session.user, role: 'admin' } }
    }
    return session
  }
}))

function planForDeletion(): AccountDeletionPlan {
  const roles: Array<WorkspaceRole> = ['member']
  if (deletion.owner) {
    roles.push('owner')
  }
  if (deletion.workspaceAdmin) {
    roles.push('admin')
  }
  return {
    canDelete: true,
    steps: roles.map((role, index) => ({
      workspace: {
        id: `wrk_${index}`,
        slug: `workspace-${index}`,
        name: 'Workspace',
        planId: 'team'
      },
      role,
      action: 'leave'
    }))
  }
}

beforeEach(() => {
  Object.assign(evidence, {
    qualified: false,
    recovering: false,
    hasFactors: false,
    passwordVerified: false
  })
  Object.assign(deletion, {
    systemAdmin: false,
    owner: false,
    workspaceAdmin: false,
    impersonated: false,
    executed: false
  })
})
const current = fixtureSession({ userId: 'usr_admin' })
function request(path: string, method: 'POST' | 'GET' = 'POST', session = current) {
  return strongAuthenticationHttpResponse(
    { method, pathname: `/api/auth${path}` },
    session
  )
}

describe('privileged authentication HTTP boundary', () => {
  it('blocks direct admin reads and mutations from an ordinary session', async () => {
    const read = await request('/admin/list-users', 'GET')
    const mutation = await request('/admin/set-role')
    expect(read?.status).toBe(403)
    expect(mutation?.status).toBe(403)
    evidence.qualified = true
    expect(await request('/admin/set-role')).toBeNull()
  })

  it('enrollment cannot turn a stolen cookie into a passkey credential', async () => {
    const weak = await request('/passkey/verify-registration')
    expect(weak?.status).toBe(403)
    evidence.passwordVerified = true
    expect(await request('/passkey/verify-registration')).toBeNull()
    evidence.hasFactors = true
    const registration = await request('/passkey/verify-registration')
    const removal = await request('/two-factor/disable')
    expect(registration?.status).toBe(403)
    expect(removal?.status).toBe(403)
  })

  it('bounded recovery can repair factors but cannot use admin operations', async () => {
    evidence.hasFactors = true
    evidence.recovering = true
    expect(await request('/two-factor/disable')).toBeNull()
    expect(await request('/passkey/verify-registration')).toBeNull()
    const admin = await request('/admin/impersonate-user')
    expect(admin?.status).toBe(403)
    expect(await request('/admin/revoke-user-sessions')).toBeNull()
  })

  it('impersonation never grants factor management, even with stale proof', async () => {
    evidence.qualified = true
    const response = await request(
      '/passkey/verify-registration',
      'POST',
      fixtureSession({ userId: 'usr_member', impersonatedBy: 'usr_admin' })
    )
    expect(response?.status).toBe(403)
  })

  it('raw organization endpoints cannot bypass capability authorization', async () => {
    evidence.qualified = true
    const mutation = await request('/organization/update-member-role')
    const read = await request('/organization/get-full-organization', 'GET')
    expect(mutation?.status).toBe(403)
    expect(read?.status).toBe(403)
  })
})

describe('account deletion capability boundary', () => {
  it.each(['systemAdmin', 'owner', 'workspaceAdmin'] satisfies Array<
    'systemAdmin' | 'owner' | 'workspaceAdmin'
  >)('requires strong proof before deleting a %s account', async (privilege) => {
    deletion[privilege] = true
    await expect(
      deleteAccountHandler({ password: 'valid-password' })
    ).rejects.toMatchObject({ _tag: 'StrongAuthenticationRequired' })
    expect(deletion.executed).toBe(false)
    evidence.qualified = true
    const result = await deleteAccountHandler({ password: 'valid-password' })
    expect(result.canDelete).toBe(true)
    expect(deletion.executed).toBe(true)
  })

  it('retains password-only deletion for an ordinary member', async () => {
    const result = await deleteAccountHandler({ password: 'valid-password' })
    expect(result.canDelete).toBe(true)
    expect(deletion.executed).toBe(true)
  })

  it('recovery cannot delete a privileged account and impersonation cannot delete any account', async () => {
    deletion.owner = true
    evidence.recovering = true
    await expect(
      deleteAccountHandler({ password: 'valid-password' })
    ).rejects.toMatchObject({ _tag: 'StrongAuthenticationRequired' })
    deletion.owner = false
    deletion.impersonated = true
    evidence.qualified = true
    await expect(
      deleteAccountHandler({ password: 'valid-password' })
    ).rejects.toMatchObject({ _tag: 'StrongAuthenticationRequired' })
    expect(deletion.executed).toBe(false)
  })
})

describe('raw product endpoint exclusions', () => {
  it.each([
    '/delete-user',
    '/delete-user/callback',
    '/sso/register',
    '/sso/providers',
    '/sso/get-provider',
    '/sso/update-provider',
    '/sso/delete-provider',
    '/sso/request-domain-verification',
    '/sso/verify-domain'
  ])('requires the capability route for %s even with strong proof', async (path) => {
    evidence.qualified = true
    const response = await request(path)
    expect(response?.status).toBe(403)
    expect(await response?.json()).toEqual({ code: 'capability_route_required' })
    const anonymous = await strongAuthenticationHttpResponse(
      { method: 'GET', pathname: `/api/auth${path}` },
      undefined
    )
    expect(anonymous?.status).toBe(403)
  })

  it.each([
    '/sign-in/sso',
    '/sso/callback',
    '/sso/callback/provider',
    '/sso/saml2/sp/metadata',
    '/sso/saml2/sp/acs/provider',
    '/sso/saml2/sp/slo/provider',
    '/sso/saml2/logout/provider'
  ])('preserves the SSO protocol endpoint %s', async (path) => {
    expect(await request(path)).toBeNull()
    expect(
      await strongAuthenticationHttpResponse(
        { method: 'GET', pathname: `/api/auth${path}` },
        undefined
      )
    ).toBeNull()
  })
})
