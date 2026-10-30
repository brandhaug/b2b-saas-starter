import { type Page } from '@playwright/test'

// No auth, capability, or provider response is intercepted.
export async function submitPurchase(
  page: Page,
  workspaceSlug: string,
  planId = 'team'
) {
  return page.request.post('/api/web/continuePurchaseServerFn', {
    headers: {
      'x-starter-client': '1',
      'content-type': 'application/json',
      origin: new URL(page.url()).origin
    },
    data: { workspaceSlug, planId }
  })
}
