import { describe, expect, it } from 'vitest'
import { Schema } from 'effect'
import {
  ImpersonationStartRequest,
  MerchantDiscoveryQuery,
  OperationsAuditRecord,
  OperationsRateLimitRequest,
  ProvisionOperatorRequest,
  hasOperatorPermission,
  makeOperationsContractFixtures,
  messagingOperatorRoleNames,
  operatorDefaultRole,
  operatorRoleNames,
  operatorRoleRegistry,
  parseOperatorRoles
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

  it('publishes one exhaustive registry for independently assignable messaging roles', () => {
    expect(messagingOperatorRoleNames).toEqual([
      'messaging-reader',
      'messaging-controller',
      'messaging-finance',
      'messaging-reconciler',
      'messaging-incident-responder'
    ])
    expect(operatorRoleNames).toEqual(Object.keys(operatorRoleRegistry))
    expect(operatorDefaultRole).toBe('merchant-reader')
    expect(
      Object.fromEntries(
        messagingOperatorRoleNames.map((role) => [
          operatorRoleRegistry[role].label,
          operatorRoleRegistry[role].permissions
        ])
      )
    ).toEqual({
      'Messaging Reader': ['messaging:read'],
      'Messaging Controller': ['messaging:control'],
      'Messaging Finance': ['messaging:finance'],
      'Messaging Reconciler': ['messaging:reconcile'],
      'Messaging Incident Responder': ['messaging:incident']
    })
  })

  it('fails closed for unknown persisted roles and grants no implicit messaging role', () => {
    expect(parseOperatorRoles('messaging-admin,unknown')).toEqual([])
    expect(parseOperatorRoles('messaging-reader,messaging-admin')).toEqual([
      'messaging-reader'
    ])
    expect(hasOperatorPermission([], 'messaging:read')).toBe(false)
    expect(hasOperatorPermission([operatorDefaultRole], 'messaging:read')).toBe(false)
  })
})
