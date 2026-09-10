// oxlint-disable-next-line import/no-unassigned-import -- Installs the explicit authenticated-session test fixture.
import '@/test/qualified-session'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { fixtureAuthModule } from '@/test/fixture-session'
import { loadWorkspaceDashboardHandler } from './workspace-dashboard.effects'
import type * as AuthModule from './auth'

/**
 * The loader through its handler, against the Seed layer: the session gate
 * is answered by the mock with the fixture identity under test. `usr_demo`
 * owns `starter-lab`, `usr_dev` is a plain member of it.
 */
const actor = vi.hoisted(() => ({ userId: 'usr_demo' }))

vi.mock('./auth', async (importOriginal) =>
  fixtureAuthModule(await importOriginal<typeof AuthModule>(), actor)
)

describe('loadWorkspaceDashboardHandler', () => {
  beforeEach(() => {
    actor.userId = 'usr_demo'
  })

  it('gives an owner the webhook delivery segment', async () => {
    const payload = await loadWorkspaceDashboardHandler({
      workspaceSlug: 'starter-lab'
    })
    expect(payload.viewer).toEqual({ role: 'owner' })
    expect(payload.webhooks?.length).toBeGreaterThan(0)
  })

  it('withholds webhook delivery from a member, who holds no webhook:list', async () => {
    actor.userId = 'usr_dev'
    const payload = await loadWorkspaceDashboardHandler({
      workspaceSlug: 'starter-lab'
    })
    expect(payload.viewer).toEqual({ role: 'member' })
    expect(payload.webhooks).toBeNull()
    // The rest of the dashboard is notification:read, which a member holds.
    expect(payload.notifications.length).toBeGreaterThan(0)
  })
})
