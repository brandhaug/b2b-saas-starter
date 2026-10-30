import { expect, test } from './authentication'
import { hasLocalD1State } from '../src/lib/local-d1-state'

test('same-turn token submissions send one request', async ({
  ownerPage: page
}, testInfo) => {
  test.skip(!hasLocalD1State(), 'requires migrated and seeded local D1')
  const name = `Submission ownership ${crypto.randomUUID()}`
  let requests = 0
  let release!: () => void
  // oxlint-disable-next-line effect/noNewPromise -- Playwright controls a deferred browser response to exercise duplicate-submit exclusion.
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/_serverFn/**', async (route) => {
    if (
      route.request().method() === 'POST' &&
      route.request().postData()?.includes(name)
    ) {
      requests += 1
      await pending
      await route.abort('failed')
      return
    }
    await route.continue()
  })
  await page.goto('/workspaces/starter-lab/api-tokens?action=create')
  await page.getByLabel('Token name', { exact: true }).fill(name)
  await page.getByLabel('Token name', { exact: true }).evaluate((input) => {
    const form = input.closest('form')
    form?.requestSubmit()
    form?.requestSubmit()
  })
  await expect.poll(() => requests).toBe(1)
  await expect(
    page.getByRole('button', { name: 'Create token', exact: true })
  ).toBeDisabled()
  release()
  await expect(
    page.getByRole('button', { name: 'Create token', exact: true })
  ).toBeEnabled()
  expect(requests).toBe(1)
  await testInfo.attach('submission-result', {
    body: 'Two synchronous submit events produced exactly one pending server request. Aborting that request restored submission without another write.',
    contentType: 'text/plain'
  })
})
