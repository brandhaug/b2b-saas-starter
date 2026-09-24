import { describe, expect, it } from 'vite-plus/test'
import { demoBillingPorts } from './demo-fixtures'
import { DEMO_WORKSPACE_SLUG } from './demo-workspace'

/**
 * The preview banner says nothing a guest does changes anything, and the
 * landing page says an unconfigured provider stays inactive. Both are claims
 * about this fixture, so they are checked here rather than trusted.
 */
describe('demo fixtures', () => {
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
