/* oxlint-disable effect/noNodeBuiltinImport -- Playwright runs this credential fixture in Node, outside application runtimes. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { expect, test as setup } from '@playwright/test'
import { hasLocalD1State } from '../src/lib/local-d1-state'
import {
  addVirtualAuthenticator,
  confirmPasswordForEnrollment,
  credentialPath,
  fixturePasskeyName,
  signInWithPassword,
  verifyWithPasskey
} from './authentication'
import { isolatedClientIp } from './test-isolation'
import { removeBrowserTestPasskeys } from './authentication-cleanup'

setup(
  'enrolls real passkeys for privileged browser tests',
  async ({ page, context }, testInfo) => {
    setup.skip(!hasLocalD1State(), 'requires migrated and seeded local D1')
    removeBrowserTestPasskeys()

    await context.setExtraHTTPHeaders({
      'cf-connecting-ip': isolatedClientIp(`authentication-setup:${Date.now()}`)
    })
    await signInWithPassword(page, 'demo@starter.local', '/account')
    await confirmPasswordForEnrollment(page)
    await page.getByRole('link', { name: 'Open account security', exact: true }).click()
    await page.waitForURL('**/account')
    await expect(page.getByText(/No passkeys yet/)).toBeVisible()
    const cdp = await context.newCDPSession(page)
    // The first enrolled key qualifies this session for subsequent enrollment.
    // Each worker then owns one counter and signs in independently.
    // oxlint-disable no-await-in-loop -- WebAuthn ceremonies share this browser and must run in order.
    for (let worker = 0; worker < testInfo.config.workers; worker += 1) {
      const authenticatorId = await addVirtualAuthenticator(cdp)
      const name = fixturePasskeyName(worker)
      await page.getByLabel('Name a new passkey').fill(name)
      await page.getByRole('button', { name: 'Add passkey', exact: true }).click()
      await expect(page.getByText(name, { exact: true })).toBeVisible({
        timeout: 15_000
      })
      if (worker === 0) {
        await page.goto('/workspaces/starter-lab/settings')
        await expect(
          page.getByRole('heading', { name: 'Verify your identity' })
        ).toBeVisible()
        await verifyWithPasskey(page, '/account')
        await expect(page.getByText(name, { exact: true })).toBeVisible()
      }
      const { credentials } = await cdp.send('WebAuthn.getCredentials', {
        authenticatorId
      })
      expect(credentials).toHaveLength(1)
      const path = credentialPath(worker)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify(credentials[0]), { mode: 0o600 })
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
    }
    // oxlint-enable no-await-in-loop
  }
)
