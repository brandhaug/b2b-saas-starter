import { describe, expect, it } from 'vite-plus/test'
import { ssoPolicyOptionsFromEnv } from './sso-policy-config.ts'

describe('SSO duration configuration', () => {
  it('uses defaults when unset or invalid', () => {
    expect(ssoPolicyOptionsFromEnv({})).toEqual({
      proofTtlMs: undefined,
      configurationAuthRecencyMs: undefined
    })
    expect(
      ssoPolicyOptionsFromEnv({
        SSO_PROOF_TTL_SECONDS: '-1',
        SSO_CONFIGURATION_AUTH_MAX_AGE_SECONDS: 'not-a-number'
      })
    ).toEqual({ proofTtlMs: undefined, configurationAuthRecencyMs: undefined })
  })

  it('converts valid operator durations to milliseconds', () => {
    expect(
      ssoPolicyOptionsFromEnv({
        SSO_PROOF_TTL_SECONDS: '3600',
        SSO_CONFIGURATION_AUTH_MAX_AGE_SECONDS: '60'
      })
    ).toEqual({ proofTtlMs: 3_600_000, configurationAuthRecencyMs: 60_000 })
  })

  it('rejects durations beyond the supported security limits', () => {
    expect(
      ssoPolicyOptionsFromEnv({
        SSO_PROOF_TTL_SECONDS: '999999999',
        SSO_CONFIGURATION_AUTH_MAX_AGE_SECONDS: '999999999'
      })
    ).toEqual({ proofTtlMs: undefined, configurationAuthRecencyMs: undefined })
  })
})
