/* oxlint-disable effect/noNodeBuiltinImport -- Playwright verifies built browser assets against the local public content tree. */
import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'

const publicDocs = new URL('../content/docs/', import.meta.url)

test('public docs search supports empty states, body matches and keyboard navigation', async ({
  page
}, testInfo) => {
  const scripts: Array<string> = []
  const assets = new URL('../dist-e2e/client/assets/', import.meta.url)
  const articleChunks = readdirSync(assets).filter(
    (file) =>
      file.endsWith('.js') &&
      /as frontmatter\s*\}/.test(readFileSync(new URL(file, assets), 'utf8'))
  )
  expect(articleChunks.length).toBeGreaterThan(0)
  page.on('request', (request) => {
    if (request.resourceType() === 'script') {
      scripts.push(request.url())
    }
  })
  const response = await page.goto('/docs/search')
  expect(response?.status()).toBe(200)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.locator('header [data-slot="select-trigger"]:enabled').waitFor()
  const input = page.getByRole('searchbox', { name: 'Search documentation' })
  await expect(page.getByRole('status')).toContainText('Search the English guides')
  await input.fill('   ')
  await input.press('Enter')
  await expect(page.getByRole('status')).toContainText('Search the English guides')
  await input.fill('zzzz-no-such-public-guide')
  await input.press('Enter')
  await expect(page.getByRole('status')).toContainText('No guides found')
  await input.fill('six-digit')
  await input.press('Enter')
  const results = page.getByRole('list', { name: 'Documentation results' })
  const quickstart = results.getByRole('link', { name: 'Quickstart', exact: true })
  await expect(quickstart).toBeVisible()
  await expect(results.getByText(/six-digit/).first()).toBeVisible()
  await expect(quickstart).toHaveAttribute('href', '/docs/getting-started/quickstart')
  await expect(
    results.getByRole('link', { name: 'View source' }).first()
  ).toHaveAttribute(
    'href',
    /github.com\/brandhaug\/b2b-saas-starter\/blob\/master\/apps\/web\/content\/docs\//
  )
  expect(
    scripts.filter(
      (url) =>
        url.includes('.mdx') || articleChunks.some((file) => url.endsWith(`/${file}`))
    )
  ).toEqual([])
  const searchChunk = scripts.find((url) => url.includes('/_knowledge.docs.search-'))
  expect(searchChunk).toBeDefined()
  const searchResponse = await page.request.get(searchChunk ?? '')
  const bundle = await searchResponse.text()
  const quickstartSource = readFileSync(
    new URL('getting-started/quickstart.mdx', publicDocs),
    'utf8'
  ).replaceAll('\r\n', '\n')
  expect(bundle).toContain(
    `sha256:${createHash('sha256').update(quickstartSource).digest('hex')}`
  )
  expect(bundle).toContain('getting-started/quickstart')
  expect(bundle).not.toMatch(
    /@mdx-js|js-yaml|capability\.workspace|\/docs\/agents\/|mdxjsEsm/
  )
  await testInfo.attach('desktop-search', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png'
  })
  await input.fill('quickstart')
  await input.press('Enter')
  await input.press('Tab')
  await page.keyboard.press('Tab')
  await expect(quickstart).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/docs\/getting-started\/quickstart$/)
  await expect(
    page.getByRole('heading', { name: 'Quickstart', exact: true })
  ).toBeVisible()
  await testInfo.attach('search-script-requests', {
    body: JSON.stringify(scripts, null, 2),
    contentType: 'application/json'
  })
})

test('docs search retains Norwegian navigation on mobile and after refresh', async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const response = await page.goto('/no/docs/getting-started/quickstart')
  expect(response?.status()).toBe(200)
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb')
  await page
    .getByRole('link', { name: 'Søk i dokumentasjonen', exact: true })
    .filter({ visible: true })
    .click()
  const input = page.getByRole('searchbox', { name: 'Søk i dokumentasjonen' })
  await input.fill('quickstart')
  await input.press('Enter')
  await page.reload()
  await expect(input).toHaveValue('quickstart')
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb')
  const result = page
    .getByRole('list', { name: 'Dokumentasjonsresultater' })
    .getByRole('link', { name: 'Quickstart', exact: true })
  await expect(result).toHaveAttribute('href', '/no/docs/getting-started/quickstart')
  await testInfo.attach('mobile-search', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png'
  })
  await result.click()
  await expect(page).toHaveURL(/\/no\/docs\/getting-started\/quickstart$/)
})
