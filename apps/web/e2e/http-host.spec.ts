import { expect, test } from '@playwright/test'

// Exercise the built host, not just the application handler. Page negotiation
// must not swallow JSON protocols, and asset misses must not become HTML pages.
// oxlint-disable-next-line vitest/prefer-each -- Playwright parameterizes tests with loops.
for (const path of ['/api/auth/get-session', '/api/support-config', '/ready']) {
  test(`JSON requests reach ${path}`, async ({ request }) => {
    const response = await request.get(path, {
      headers: { Accept: 'application/json' }
    })
    expect(response.status(), path).toBe(200)
    expect(response.headers()['content-type'], path).toContain('application/json')
  })
}

test('discovery is available to JSON clients', async ({ request }) => {
  const response = await request.get(
    '/.well-known/oauth-authorization-server/api/auth',
    {
      headers: { Accept: 'application/json' }
    }
  )
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('application/json')
  expect(await response.json()).toHaveProperty('issuer')
})

test('page HEAD and missing asset preserve HTTP semantics', async ({ request }) => {
  const head = await request.head('/sign-in')
  expect(head.status()).toBe(200)
  expect(await head.body()).toHaveLength(0)
  const missing = await request.get('/assets/not-a-real-bundle.js')
  expect(missing.status()).toBe(404)
  expect(missing.headers()['content-type'] ?? '').not.toContain('text/html')
  const unknownPage = await request.get('/docs/getting-started/not-a-real-article')
  expect(unknownPage.status()).toBe(404)
})
