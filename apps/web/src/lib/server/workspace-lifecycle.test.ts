import { describe, expect, it } from 'vite-plus/test'

import {
  UnverifiedEmailError,
  unverifiedCreatorRefused
} from './workspace-lifecycle.effects'

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

describe('UnverifiedEmailError', () => {
  it('carries the discriminant name and the sentence the form shows', () => {
    expect(new UnverifiedEmailError().name).toBe('UnverifiedEmailError')
    expect(new UnverifiedEmailError().message).toBe(
      'Verify your email address before creating a workspace.'
    )
  })
})
