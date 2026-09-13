import { expect, test } from './authentication'
import { hasLocalD1State } from '../src/lib/local-d1-state'

// The local preview has D1 but no webhook queue. It must retain the approved
// replay for recovery without presenting a successful HTTP delivery.
test('retains an approved investigation after an unavailable queue', async ({
  ownerPage
}, testInfo) => {
  test.skip(!hasLocalD1State(), 'requires migrated and seeded local D1')
  const page = ownerPage
  await page.goto('/workspaces/starter-lab/assistant?deliveryId=whd_seed_dead_lettered')
  await page
    .getByLabel('Investigation request')
    .fill('Investigate the exhausted receiver failure')
  await page.getByRole('button', { name: 'Investigate delivery', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Approve replay', exact: true })
  ).toBeVisible()
  await expect(page).toHaveURL(/taskId=task_/)
  const taskUrl = page.url()
  await page.reload()
  await expect(
    page.getByText('Investigate the exhausted receiver failure', { exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Approve replay', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Retry replay', exact: true })
  ).toBeVisible()
  await expect(page.getByText('Replay outcome: pending', { exact: true })).toBeVisible()
  await page.goto(taskUrl)
  await expect(page.getByText('Replay outcome: pending', { exact: true })).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('assistant-investigation-desktop.png'),
    fullPage: true
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    page.getByRole('button', { name: 'Retry replay', exact: true })
  ).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('assistant-investigation-mobile.png'),
    fullPage: true
  })
})
