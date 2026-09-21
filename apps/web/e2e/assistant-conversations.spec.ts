import { expect, signInWithPassword, test } from './authentication'
import { hasLocalD1State } from '../src/lib/local-d1-state'

test('reopens a private conversation across tabs without a configured provider', async ({
  page,
  context
}, testInfo) => {
  test.skip(!hasLocalD1State(), 'requires migrated and seeded local D1')
  await signInWithPassword(
    page,
    'engineer@example.com',
    '/workspaces/starter-lab/assistant'
  )
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .first()
    .click()
  await expect(page).toHaveURL(/conversationId=conversation_/)
  const conversationUrl = page.url()
  const connected = 'Connected to saved history and live progress'
  await expect(page.getByText(connected, { exact: true })).toBeVisible()
  await expect(
    page.getByText('No answer provider is configured.', { exact: false })
  ).toBeVisible()
  await expect(page.getByLabel('Your question', { exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeDisabled()

  const secondTab = await context.newPage()
  await secondTab.goto(conversationUrl)
  await expect(secondTab.getByText(connected, { exact: true })).toBeVisible()
  await secondTab.close()
  await page.goto('/workspaces/starter-lab')
  await page.goto(conversationUrl)
  await expect(page.getByText(connected, { exact: true })).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('assistant-conversations-desktop.png'),
    fullPage: true
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    page.getByRole('button', { name: 'Delete conversation', exact: true })
  ).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('assistant-conversations-mobile.png'),
    fullPage: true
  })
  await page.getByRole('button', { name: 'Delete conversation', exact: true }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete conversation', exact: true })
    .click()
  await expect(page).not.toHaveURL(/conversationId=/)
  await expect(
    page.getByText('Choose a saved conversation or start a new one.', { exact: true })
  ).toBeVisible()
})
