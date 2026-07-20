import { describe, expect, it } from 'vitest'
import { Schema } from 'effect'
import {
  ImpersonationStartRequest,
  MerchantDiscoveryQuery,
  OperationsAuditRecord,
  OperationsRateLimitRequest,
  ProvisionOperatorRequest,
  makeOperationsContractFixtures
} from './operations-contracts.ts'

describe('Operations transport-neutral contracts', () => {
  it('decodes fixtures for every independent Operations workstream', () => {
    const fixtures = makeOperationsContractFixtures()
    expect(
      Schema.decodeUnknownSync(ProvisionOperatorRequest)(fixtures.provisioning)
    ).toEqual(fixtures.provisioning)
    expect(
      Schema.decodeUnknownSync(MerchantDiscoveryQuery)(fixtures.discovery)
    ).toEqual(fixtures.discovery)
    expect(Schema.decodeUnknownSync(OperationsAuditRecord)(fixtures.audit)).toEqual(
      fixtures.audit
    )
    expect(
      Schema.decodeUnknownSync(OperationsRateLimitRequest)(fixtures.rateLimit)
    ).toEqual(fixtures.rateLimit)
    expect(
      Schema.decodeUnknownSync(ImpersonationStartRequest)(fixtures.impersonation)
    ).toEqual(fixtures.impersonation)
  })

  it('keeps credentials, cookies, and HTTP objects outside shared contracts', () => {
    const serialized = JSON.stringify(makeOperationsContractFixtures())
    expect(serialized).not.toMatch(
      /password|totpSecret|backupCode|cookie|bearer|Request|Response/
    )
    expect(serialized).not.toMatch(/"actor":\{[^}]*"roles"/)
    expect(serialized).not.toMatch(/"actor":\{[^}]*"operatorId"/)
  })
})
