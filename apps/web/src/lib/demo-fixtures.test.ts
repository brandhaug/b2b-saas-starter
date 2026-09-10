import { seedMembers } from '@b2b-saas-starter/capabilities/governance/workspace-identity.seed'
import { describe, expect, it } from 'vite-plus/test'
import { demoBillingPorts, demoFixtures } from './demo-fixtures'
import { DEMO_WORKSPACE_SLUG } from './demo-workspace'

/**
 * The preview banner says nothing a guest does changes anything, and the
 * landing page says an unconfigured provider stays inactive. Both are claims
 * about this fixture, so they are checked here rather than trusted.
 */
describe('demo fixtures', () => {
  it('shows the seed workspace, not a retyped copy of it', () => {
    expect(demoFixtures.dashboard.workspace.slug).toBe(DEMO_WORKSPACE_SLUG)
    // The roster is the fixture's own export, so the check that matters is
    // that every demo member is a seed member, not a persona typed here.
    for (const member of demoFixtures.members.members) {
      expect(seedMembers.map((seeded) => seeded.email)).toContain(member.email)
    }
  })

  it('leaves the optional providers inactive', () => {
    expect(demoFixtures.billing.stripeConfigured).toBe(false)
    expect(demoFixtures.assistant.configured).toBe(false)
  })

  it('refuses every billing action instead of reaching a provider', async () => {
    const attempts = [
      demoBillingPorts.startCheckout({
        data: { workspaceSlug: DEMO_WORKSPACE_SLUG, planId: 'team' }
      }),
      demoBillingPorts.startPortalSession({
        data: { workspaceSlug: DEMO_WORKSPACE_SLUG }
      }),
      demoBillingPorts.selectBillingResources({
        data: {
          workspaceSlug: DEMO_WORKSPACE_SLUG,
          apiTokenIds: [],
          webhookEndpointIds: []
        }
      })
    ]
    for (const attempt of attempts) {
      await expect(attempt).rejects.toThrow(/preview/i)
    }
  })
})
