// oxlint-disable-next-line import/no-unassigned-import -- Installs the explicit authenticated-session test fixture.
import '@/test/qualified-session'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { fixtureAuthModule } from '@/test/fixture-session'
import { loadWorkspaceSettingsHandler } from './workspace-settings.effects'
import type * as AuthModule from './auth'

/**
 * The loader through its handler: the session gate is answered by the mock
 * with the fixture identity under test, and the rest is the real path over
 * the Seed layer (the inert `cloudflare:workers` shim under Vitest).
 * `usr_demo` owns `starter-lab`, `usr_dev` is a plain member, `usr_ops` is
 * its admin — which is what makes the payloads comparable.
 */
const actor = vi.hoisted(() => ({ userId: 'usr_demo' }))

vi.mock('./auth', async (importOriginal) =>
  fixtureAuthModule(await importOriginal<typeof AuthModule>(), actor)
)

describe('loadWorkspaceSettingsHandler', () => {
  beforeEach(() => {
    actor.userId = 'usr_demo'
  })

  it('names the workspace and badges unread for an owner', async () => {
    const payload = await loadWorkspaceSettingsHandler({ workspaceSlug: 'starter-lab' })
    expect(payload.viewer).toEqual({ role: 'owner' })
    expect(payload.workspaceName).toBeTypeOf('string')
    expect(payload.unreadCount).toBeTypeOf('number')
    // The SSO segment carries the disabled seeded example connection, and no
    // secret: the sanitized DTO is all there is (ADR 0069).
    expect(payload.ssoConnections).toHaveLength(1)
    expect(payload.ssoConnections?.[0]).toMatchObject({
      id: 'sso_example_oidc',
      protocol: 'oidc',
      enabled: false,
      domain: 'acme-corp.example'
    })
    expect(JSON.stringify(payload.ssoConnections)).not.toContain('secret')
    // The export segment: available on the Seed layer, with the fixture export
    // ready, without issuing a download credential on a settings read.
    expect(payload.exports?.availability).toEqual({ available: true })
    const fixture = payload.exports?.exports.find((row) => row.id === 'exp_seed_ready')
    expect(fixture?.status).toBe('ready')
    expect(fixture).not.toHaveProperty('downloadUrl')
  })

  it('gives a member the same settings payload — the page reads only identity', async () => {
    // Settings carries the workspace's name and nothing permission-shaped:
    // the roster and invitations moved to the members page, so there is no
    // soft segment left to withhold and the payloads converge.
    actor.userId = 'usr_dev'
    const payload = await loadWorkspaceSettingsHandler({ workspaceSlug: 'starter-lab' })
    expect(payload.viewer).toEqual({ role: 'member' })
    expect(payload.workspaceName).toBeTypeOf('string')
    expect(payload.unreadCount).toBeTypeOf('number')
    // SSO connections are security posture: the member's payload carries no
    // connection list at all, not an empty one.
    expect(payload.ssoConnections).toBeNull()
    // The export segment is owner-only: denied by the matrix server-side, so
    // it never reaches the serialized loader payload at all.
    expect(payload.exports).toBeNull()
  })

  it('withholds the export segment from an admin — it is owner-only', async () => {
    actor.userId = 'usr_ops'
    const payload = await loadWorkspaceSettingsHandler({ workspaceSlug: 'starter-lab' })
    expect(payload.viewer).toEqual({ role: 'admin' })
    expect(payload.exports).toBeNull()
  })
})
