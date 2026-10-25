import { expect, test } from '@playwright/test'

test('public agent indexes serve English Markdown and linked articles', async ({
  request
}) => {
  const indexResponse = await request.get('/agent-docs/index.json', {
    headers: { 'Accept-Language': 'nb' }
  })
  expect(indexResponse.status()).toBe(200)
  const index = await indexResponse.json()
  expect(index.language).toBe('en')
  // oxlint-disable-next-line effect/noNewPromise -- Playwright request checks are independent Promise boundaries
  await Promise.all(
    [
      '/llms.txt',
      '/llms-full.txt',
      '/agent-docs/getting-started/quickstart.md',
      '/agent-docs/architecture/overview.md',
      '/agent-docs/capability-interfaces/sdk.md'
    ].map(async (path) => {
      const response = await request.get(path, { headers: { 'Accept-Language': 'nb' } })
      expect(response.status()).toBe(200)
      expect(new URL(response.url()).pathname).toBe(path)
      const body = await response.text()
      expect(body).toMatch(/^# /u)
      expect(body).not.toContain('<!DOCTYPE html>')
      // oxlint-disable-next-line effect/noNewPromise -- fetch linked static assets concurrently through Playwright
      await Promise.all(
        [...body.matchAll(/\]\((\/agent-docs\/[^)#]+)(?:#[^)]*)?\)/gu)].map(
          async (match) => {
            const linked = await request.get(match[1] ?? '')
            expect(linked.status(), match[1]).toBe(200)
            expect(await linked.text()).not.toContain('<!DOCTYPE html>')
          }
        )
      )
    })
  )
})
