import { describe, expect, it } from 'vitest'
import { type RequiredEnvProblem } from '@b2b-saas-starter/env'
import { enforceRequiredEnvAudit, InsecureProductionEnvError } from './env-gate.ts'

describe('enforceRequiredEnvAudit', () => {
  it('passes a clean production audit', () => {
    expect(() =>
      enforceRequiredEnvAudit({
        mode: 'production',
        problems: []
      })
    ).not.toThrow()
  })

  it('is silent for local and non-production deployments', () => {
    // Even with problems: a non-production deployment warns via a wide
    // event, it does not refuse to serve.
    expect(() =>
      enforceRequiredEnvAudit({
        mode: 'local',
        problems: []
      })
    ).not.toThrow()
    expect(() =>
      enforceRequiredEnvAudit({
        mode: 'deployed',
        problems: [{ key: 'BETTER_AUTH_SECRET', reason: 'missing' }]
      })
    ).not.toThrow()
  })

  it('refuses to serve when production required env is insecure', () => {
    const problems: readonly RequiredEnvProblem[] = [
      { key: 'BETTER_AUTH_SECRET', reason: 'placeholder' },
      { key: 'BETTER_AUTH_URL', reason: 'missing' }
    ]
    // The thrown message names the vars and the reason — never the secret's
    // value — which is what a failing deployment's operator needs to see.
    expect(() => enforceRequiredEnvAudit({ mode: 'production', problems })).toThrow(
      InsecureProductionEnvError
    )
    expect(() => enforceRequiredEnvAudit({ mode: 'production', problems })).toThrow(
      /BETTER_AUTH_SECRET \(placeholder\)/
    )
    expect(() => enforceRequiredEnvAudit({ mode: 'production', problems })).toThrow(
      /BETTER_AUTH_URL \(missing\)/
    )
  })
})
