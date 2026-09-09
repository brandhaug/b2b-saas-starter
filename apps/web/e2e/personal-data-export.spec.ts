/* oxlint-disable effect/noNodeBuiltinImport -- Playwright inspects the downloaded archive in Node. */
import { readFile } from 'node:fs/promises'
import { expect, test } from './authentication'
import { hasLocalD1State } from '../src/lib/local-d1-state'
import { isolatedClientIp } from './test-isolation'

test('prepares and downloads the signed-in account personal data', async ({
  ownerPage,
  context
}, testInfo) => {
  test.skip(!hasLocalD1State(), 'requires migrated and seeded local D1')
  await context.setExtraHTTPHeaders({
    'cf-connecting-ip': isolatedClientIp(testInfo.testId)
  })
  await ownerPage.goto('/account')
  await ownerPage.locator('header select:enabled').waitFor({ state: 'attached' })
  await ownerPage
    .getByRole('button', { name: 'Prepare personal data', exact: true })
    .click()
  const downloadButton = ownerPage.getByRole('button', {
    name: 'Download personal data',
    exact: true
  })
  await expect(downloadButton).toBeEnabled()
  await downloadButton.scrollIntoViewIfNeeded()
  await ownerPage.screenshot({
    path: testInfo.outputPath('personal-data-export-desktop.png')
  })
  await ownerPage.setViewportSize({ width: 390, height: 844 })
  await downloadButton.scrollIntoViewIfNeeded()
  await ownerPage.screenshot({
    path: testInfo.outputPath('personal-data-export-mobile.png')
  })
  const downloadEvent = ownerPage.waitForEvent('download')
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
})
