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
  it('gives an owner every segment of the settings payload', async () => {
    const payload = await loadWorkspaceSettings({
      workspaceSlug: 'starter-lab',
      userId: OWNER
    })
    expect(payload.viewer).toEqual({ role: 'owner' })
    expect(payload.apiTokenCount).toBeTypeOf('number')
    expect(payload.webhookCount).toBeTypeOf('number')
    expect(payload.invitations).toBeInstanceOf(Array)
  })

  it('withholds the segments a member may not read', async () => {
    const payload = await loadWorkspaceSettings({
      workspaceSlug: 'starter-lab',
      userId: MEMBER
    })
    expect(payload.viewer).toEqual({ role: 'member' })
    expect(payload.unreadCount).toBeTypeOf('number')
    // Denied by the matrix — and denied server-side, so the numbers never
    // reach the serialized loader payload at all.
    expect(payload.apiTokenCount).toBeNull()
    expect(payload.webhookCount).toBeNull()
    expect(payload.invitations).toBeNull()
  })
})
