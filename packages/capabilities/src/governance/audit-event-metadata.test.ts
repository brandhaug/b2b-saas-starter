import { describe, expect, it } from '@effect/vitest'
import { decodeAuditEventMetadata } from './audit-event-metadata.ts'

describe('permitted audit metadata', () => {
  it('keeps only validated operational fields and discards unknown or sensitive values', () => {
    expect(
      decodeAuditEventMetadata({
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
    expect(decodeAuditEventMetadata({ attempts: { secret: 'hidden' } })).toEqual({})
    expect(decodeAuditEventMetadata({ role: 'private arbitrary value' })).toEqual({})
    expect(decodeAuditEventMetadata({ responseStatus: 999 })).toEqual({})
    expect(decodeAuditEventMetadata({ sizeBytes: -1 })).toEqual({})
    expect(decodeAuditEventMetadata({ attempts: 2, role: 'invalid' })).toEqual({})
  })

  it.each([null, undefined, 'private text', ['private'], 42])(
    'discards malformed stored metadata %j',
    (metadata) => {
      expect(decodeAuditEventMetadata(metadata)).toEqual({})
    }
  )
})
