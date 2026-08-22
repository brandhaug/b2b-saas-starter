import { describe, expect, it } from 'vitest'
import { loadWorkspaceDashboard } from './workspace-dashboard'

// Same Seed-layer harness as workspace-settings.test.ts: `usr_demo` owns
// `starter-lab`, `usr_dev` is a plain member of it.
describe('loadWorkspaceDashboard', () => {
  it('gives an owner the webhook delivery segment', async () => {
    const payload = await loadWorkspaceDashboard({
      workspaceSlug: 'starter-lab',
      userId: 'usr_demo'
    })
    expect(payload.viewer).toEqual({ role: 'owner' })
    expect(payload.webhooks?.length).toBeGreaterThan(0)
  })

  it('withholds webhook delivery from a member, who holds no webhook:list', async () => {
    const payload = await loadWorkspaceDashboard({
      workspaceSlug: 'starter-lab',
      userId: 'usr_dev'
    })
    expect(payload.viewer).toEqual({ role: 'member' })
    expect(payload.webhooks).toBeNull()
    // The rest of the dashboard is notification:read, which a member holds.
    expect(payload.notifications.length).toBeGreaterThan(0)
  })
})
