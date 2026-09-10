// oxlint-disable-next-line import/no-unassigned-import -- Installs the explicit authenticated-session test fixture.
import '@/test/qualified-session'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { fixtureAuthModule } from '@/test/fixture-session'
import { loadWorkspaceDashboardHandler } from './workspace-dashboard.effects'
import { dismissOnboardingChecklistHandler } from './workspace-onboarding.effects'
import type * as AuthModule from './auth'

/**
 * Dismissal through its handler: the session gate is answered by the mock
 * with the fixture identity under test, and the rest is the real path
 * (`runWorkspaceCapabilities` over the Seed layer — the inert
 * `cloudflare:workers` shim under Vitest). `usr_demo` owns `starter-lab`,
 * `usr_ops` is its admin, `usr_dev` a plain member. The once-only rule
 * (a second dismissal resolves `false`, no second audit row) is the
 * capability's own contract. Real clock on purpose: plain `it`.
 */
const actor = vi.hoisted(() => ({ userId: 'usr_demo' }))

vi.mock('./auth', async (importOriginal) =>
  fixtureAuthModule(await importOriginal<typeof AuthModule>(), actor)
)

describe('dismissOnboardingChecklistHandler', () => {
  beforeEach(() => {
    actor.userId = 'usr_demo'
  })

  it('lets an owner dismiss', async () => {
    await expect(
      dismissOnboardingChecklistHandler({ workspaceSlug: 'starter-lab' })
    ).resolves.toBe(true)
  })

  it('lets an admin dismiss', async () => {
    actor.userId = 'usr_ops'
    await expect(
      dismissOnboardingChecklistHandler({ workspaceSlug: 'starter-lab' })
    ).resolves.toBe(true)
  })

  it('denies a plain member — the checklist is read-only for them', async () => {
    actor.userId = 'usr_dev'
    await expect(
      dismissOnboardingChecklistHandler({ workspaceSlug: 'starter-lab' })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
  })
})

// The dashboard loader against the Seed layer: `usr_demo` owns `starter-lab`,
// `usr_dev` is a plain member of it.
describe('loadWorkspaceDashboardHandler progress', () => {
  beforeEach(() => {
    actor.userId = 'usr_demo'
  })

  it('shows the owner the Seed Workspace partially complete', async () => {
    const payload = await loadWorkspaceDashboardHandler({
      workspaceSlug: 'starter-lab'
    })
    expect(payload.progress.totalCount).toBe(4)
    expect(payload.progress.completedCount).toBe(3)
    expect(payload.progress.dismissedAt).toBeNull()
  })

  it('omits the token and webhook steps for a member', async () => {
    actor.userId = 'usr_dev'
    const payload = await loadWorkspaceDashboardHandler({
      workspaceSlug: 'starter-lab'
    })
    expect(payload.progress.steps.map((step) => step.id)).toEqual([
      'invite_member',
      'enable_two_factor'
    ])
  })
})
