import { describe, expect, it, vi } from 'vite-plus/test'

import { fixtureSession } from '@/test/fixture-session'
import {
  createWorkspaceHandler,
  unverifiedCreatorRefused
} from './workspace-lifecycle.effects'
import type * as AuthModule from './auth'

/** The verification stance the gate keys off; local dev leaves it open. */
vi.mock('cloudflare:workers', () => ({
  env: { ENVIRONMENT: 'production', DB: undefined }
}))

const creator = vi.hoisted(() => ({ emailVerified: true }))

vi.mock('./auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  requireRequestSession: async () =>
    fixtureSession({ userId: 'usr_demo', emailVerified: creator.emailVerified })
}))

/**
 * The creation gate's decision, driven as the exported branch rather than the
 * request handler that calls it — the same seam `enforceRequiredEnvAudit`
 * exposes for `env-gate.ts`. The derivation must state exactly what the
 * plugin's `allowUserToCreateOrganization` callback states, because the
 * plugin's gate never runs on this app's own creation path (the endpoint is
 * headerless, so Better Auth treats the call as a system action).
 */
describe('unverifiedCreatorRefused', () => {
  it('refuses an unverified mailbox only when verification is enforced', () => {
    expect(
      unverifiedCreatorRefused({ emailVerified: false, environment: 'production' })
    ).toBe(true)
  })

  it('admits a verified mailbox in production', () => {
    expect(
      unverifiedCreatorRefused({ emailVerified: true, environment: 'production' })
    ).toBe(false)
  })

  it('stays open outside production — local dev could never pass the gate', () => {
    expect(
      unverifiedCreatorRefused({ emailVerified: false, environment: undefined })
    ).toBe(false)
    expect(
      unverifiedCreatorRefused({ emailVerified: false, environment: 'staging' })
    ).toBe(false)
  })
})

describe('createWorkspaceHandler', () => {
  it('refuses an unverified creator as an allowlisted UI error', async () => {
    // The refusal has to reach the caller as a `UiError` code: that is the
    // only shape `causeMessage` can translate on the creation form.
    creator.emailVerified = false
    await expect(
      createWorkspaceHandler({ name: 'New Workspace', slug: 'new-workspace' })
    ).rejects.toMatchObject({
      name: 'UnverifiedEmailError',
      code: 'unverified_email'
    })
  })
})
