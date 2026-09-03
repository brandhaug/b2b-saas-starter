import { describe, expect, it } from 'vite-plus/test'
import { loadWorkspaceSettings } from './workspace-settings'

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
    // secret: the sanitized DTO is all there is (ADR 0055).
    expect(payload.ssoConnections).toHaveLength(1)
    expect(payload.ssoConnections?.[0]).toMatchObject({
      id: 'sso_example_oidc',
      protocol: 'oidc',
      enabled: false,
      domain: 'acme-corp.example'
    })
    expect(JSON.stringify(payload.ssoConnections)).not.toContain('secret')
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
  })
})
