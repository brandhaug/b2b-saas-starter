import { describe, expect, it } from 'vite-plus/test'
import { loadWorkspaceSettings } from './workspace-settings.effects'

/**
 * The loader seam, driven against the Seed layer: `runWorkspaceCapabilities`
 * resolves `cloudflare:workers` to the inert shim under Vitest (vite.config.ts),
 * so `DB` is undefined and the in-memory fixture answers. Both users below are
 * seed members of `starter-lab` — `usr_demo` owns it, `usr_dev` is a plain
 * member — which is what makes the two payloads comparable.
 */
const OWNER = 'usr_demo'
const MEMBER = 'usr_dev'

describe('loadWorkspaceSettings', () => {
  it('names the workspace and badges unread for an owner', async () => {
    const payload = await loadWorkspaceSettings({
      workspaceSlug: 'starter-lab',
      userId: OWNER
    })
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
    // ready and carrying a signed link into the API worker.
    expect(payload.exports?.availability).toEqual({ available: true })
    const fixture = payload.exports?.exports.find((row) => row.id === 'exp_seed_ready')
    expect(fixture?.status).toBe('ready')
    expect(fixture?.downloadUrl).toMatch(
      /^http:\/\/localhost:8787\/exports\/exp_seed_ready\/download\?expires=\d+&signature=[0-9a-f]{64}$/
    )
  })

  it('gives a member the same settings payload — the page reads only identity', async () => {
    // Settings carries the workspace's name and nothing permission-shaped:
    // the roster and invitations moved to the members page, so there is no
    // soft segment left to withhold and the payloads converge.
    const payload = await loadWorkspaceSettings({
      workspaceSlug: 'starter-lab',
      userId: MEMBER
    })
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
    const payload = await loadWorkspaceSettings({
      workspaceSlug: 'starter-lab',
      userId: 'usr_ops'
    })
    expect(payload.viewer).toEqual({ role: 'admin' })
    expect(payload.exports).toBeNull()
  })
})
