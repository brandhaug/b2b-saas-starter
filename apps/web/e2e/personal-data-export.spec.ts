/* oxlint-disable effect/noNodeBuiltinImport -- Playwright inspects the downloaded archive in Node. */
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { hasLocalD1State } from '../src/lib/local-d1-state'
import { signInAsOwner } from './authentication'
import { isolatedClientIp } from './test-isolation'

test('prepares and downloads the signed-in account personal data', async ({
  page,
  context
}, testInfo) => {
  test.skip(!hasLocalD1State(), 'requires migrated and seeded local D1')
  await context.setExtraHTTPHeaders({
    'cf-connecting-ip': isolatedClientIp(testInfo.testId)
  })
  const authenticator = await signInAsOwner(page, '/account')
  await page.getByRole('button', { name: 'Prepare personal data', exact: true }).click()
  const downloadButton = page.getByRole('button', {
    name: 'Download personal data',
    exact: true
  })
  await expect(downloadButton).toBeEnabled()
  await downloadButton.scrollIntoViewIfNeeded()
  await page.screenshot({
    path: testInfo.outputPath('personal-data-export-desktop.png')
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await downloadButton.scrollIntoViewIfNeeded()
  await page.screenshot({
    path: testInfo.outputPath('personal-data-export-mobile.png')
  })
  const downloadEvent = page.waitForEvent('download')
  await downloadButton.click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('personal-data-usr_demo.json')
  const archivePath = testInfo.outputPath('personal-data.json')
  await download.saveAs(archivePath)
  const json = await readFile(archivePath, 'utf8')
  expect(JSON.parse(json)).toMatchObject({
    schemaVersion: 1,
    user: { id: 'usr_demo', email: 'demo@starter.local' },
    workspaces: [
      expect.objectContaining({
        workspace: expect.objectContaining({ slug: 'starter-lab' })
      })
    ]
  })
  expect(json).not.toContain('engineer@example.com')
  expect(json).not.toContain('demo-starter-password')
  expect(json).not.toContain('"token":')
  expect(json).not.toContain('"publicKey":')
  await authenticator.cdp.send('WebAuthn.removeVirtualAuthenticator', {
    authenticatorId: authenticator.authenticatorId
  })
})
