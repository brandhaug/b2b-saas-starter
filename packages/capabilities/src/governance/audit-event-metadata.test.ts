import { describe, expect, it } from '@effect/vitest'
import { permittedAuditMetadata } from './audit-event-metadata.ts'

describe('permitted audit metadata', () => {
  it('keeps only validated operational fields and discards unknown or sensitive values', () => {
    expect(
      permittedAuditMetadata({
        role: 'admin',
        protocol: 'saml',
        attempts: 0,
        responseStatus: null,
        sizeBytes: 42,
        token: 'secret',
        email: 'private@example.com',
        name: 'private name',
        ip: '127.0.0.1',
        scopes: ['read'],
        nested: { role: 'owner', password: 'secret' }
      })
    ).toEqual({
      role: 'admin',
      protocol: 'saml',
      attempts: 0,
      responseStatus: null,
      sizeBytes: 42
    })
  })

  it('fails closed on malformed approved fields', () => {
    expect(permittedAuditMetadata({ attempts: { secret: 'hidden' } })).toEqual({})
    expect(permittedAuditMetadata({ role: 'private arbitrary value' })).toEqual({})
    expect(permittedAuditMetadata({ responseStatus: 999 })).toEqual({})
    expect(permittedAuditMetadata({ sizeBytes: -1 })).toEqual({})
  })
})
