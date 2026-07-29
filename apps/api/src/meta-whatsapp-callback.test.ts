import { describe, expect, it, vi } from 'vitest'
import {
  makeD1MetaWhatsAppCallbackHandler,
  makeMetaWhatsAppCallbackHandler,
  signMetaBody
} from './meta-whatsapp-callback.ts'

const callbackBody = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba_1',
      changes: [
        {
          field: 'messages',
          value: {
            metadata: { phone_number_id: '123456789' },
            statuses: [
              {
                id: 'wamid.HBgLMETA',
                status: 'delivered',
                timestamp: '1785315598',
                recipient_id: '40722123456',
                pricing: { billable: true, pricing_model: 'PMP', category: 'utility' }
              }
            ]
          }
        }
      ]
    }
  ]
})

describe('unversioned Meta callback edge', () => {
  it('protects challenge handling independently from signed POST ingestion', async () => {
    const handler = makeMetaWhatsAppCallbackHandler({
      appSecret: 'app-secret',
      verifyToken: 'verify-token',
      maxBodyBytes: 64 * 1024,
      captureReceipt: vi.fn(),
      ingest: vi.fn(async () => ({ intentIds: [], unresolvedCount: 0 }))
    })
    const response = await handler(
      new Request(
        'https://api.example.com/callbacks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=abc123'
      )
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('abc123')
  })

  it('keeps challenge verification available when POST-only secrets are absent', async () => {
    const handler = makeD1MetaWhatsAppCallbackHandler({
      META_WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-token'
    })
    const challenge = await handler(
      new Request(
        'https://api.example.com/callbacks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=setup-ok'
      )
    )
    const post = await handler(
      new Request('https://api.example.com/callbacks/meta/whatsapp', { method: 'POST' })
    )
    expect(await challenge.text()).toBe('setup-ok')
    expect(post.status).toBe(503)
  })

  it('verifies raw bytes, durably captures before ingest, and wakes work best effort', async () => {
    const order: string[] = []
    const captureReceipt = vi.fn(async () => {
      order.push('captured')
    })
    const ingest = vi.fn(async () => {
      order.push('ingested')
      return {
        intentIds: ['nti_fixture_ro_confirmation'],
        unresolvedCount: 0
      }
    })
    const wake = vi.fn(async () => {
      order.push('woken')
      throw new Error('queue unavailable')
    })
    const handler = makeMetaWhatsAppCallbackHandler({
      appSecret: 'app-secret',
      verifyToken: 'verify-token',
      maxBodyBytes: 64 * 1024,
      captureReceipt,
      ingest,
      wake
    })
    const signature = await signMetaBody(
      'app-secret',
      new TextEncoder().encode(callbackBody)
    )
    const response = await handler(
      new Request('https://api.example.com/callbacks/meta/whatsapp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': `sha256=${signature}`
        },
        body: callbackBody
      })
    )

    expect(response.status).toBe(200)
    expect(order).toEqual(['captured', 'ingested', 'woken'])
    expect(captureReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        rawBodyDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
      })
    )
  })

  it('rejects invalid signatures, methods, oversized bodies, and malformed shapes', async () => {
    const handler = makeMetaWhatsAppCallbackHandler({
      appSecret: 'app-secret',
      verifyToken: 'verify-token',
      maxBodyBytes: 8,
      captureReceipt: vi.fn(),
      ingest: vi.fn(async () => ({ intentIds: [], unresolvedCount: 0 }))
    })
    const malformedBody = '{}'
    const malformedSignature = await signMetaBody(
      'app-secret',
      new TextEncoder().encode(malformedBody)
    )
    const cases = [
      new Request('https://api.example.com/callbacks/meta/whatsapp', { method: 'PUT' }),
      new Request('https://api.example.com/callbacks/meta/whatsapp', {
        method: 'POST',
        headers: { 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` },
        body: callbackBody
      }),
      new Request('https://api.example.com/callbacks/meta/whatsapp', {
        method: 'POST',
        headers: { 'x-hub-signature-256': `sha256=${malformedSignature}` },
        body: malformedBody
      })
    ]
    const statuses = await Promise.all(
      cases.map(async (request) => (await handler(request)).status)
    )
    expect(statuses).toEqual([405, 413, 400])
  })

  it('retains retryable and unknown failed statuses as nonterminal evidence', async () => {
    const ingest = vi.fn(async () => ({ intentIds: [], unresolvedCount: 0 }))
    const handler = makeMetaWhatsAppCallbackHandler({
      appSecret: 'app-secret',
      verifyToken: 'verify-token',
      maxBodyBytes: 64 * 1024,
      captureReceipt: vi.fn(),
      ingest
    })
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                statuses: [
                  {
                    id: 'wamid.retryable',
                    status: 'failed',
                    timestamp: '1785315598',
                    errors: [{ code: 130429 }]
                  },
                  {
                    id: 'wamid.unknown',
                    status: 'failed',
                    timestamp: '1785315599',
                    errors: [{ code: 999999 }]
                  }
                ]
              }
            }
          ]
        }
      ]
    })
    const signature = await signMetaBody('app-secret', new TextEncoder().encode(body))
    const response = await handler(
      new Request('https://api.example.com/callbacks/meta/whatsapp', {
        method: 'POST',
        headers: { 'x-hub-signature-256': `sha256=${signature}` },
        body
      })
    )

    expect(response.status).toBe(200)
    expect(ingest).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          status: 'rejected_retryable',
          errorCode: 130429,
          errorPolicyVersion: 'meta-errors-2026-07-29'
        }),
        expect.objectContaining({
          status: 'submission_unknown',
          errorCode: 999999,
          errorPolicyVersion: 'meta-errors-2026-07-29'
        })
      ],
      expect.any(String)
    )
  })

  it('asks Meta to retry after durably capturing an event that cannot yet correlate', async () => {
    const captureReceipt = vi.fn(async () => undefined)
    const handler = makeMetaWhatsAppCallbackHandler({
      appSecret: 'app-secret',
      verifyToken: 'verify-token',
      maxBodyBytes: 64 * 1024,
      captureReceipt,
      ingest: vi.fn(async () => ({ intentIds: [], unresolvedCount: 1 }))
    })
    const signature = await signMetaBody(
      'app-secret',
      new TextEncoder().encode(callbackBody)
    )
    const response = await handler(
      new Request('https://api.example.com/callbacks/meta/whatsapp', {
        method: 'POST',
        headers: { 'x-hub-signature-256': `sha256=${signature}` },
        body: callbackBody
      })
    )

    expect(captureReceipt).toHaveBeenCalledOnce()
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('30')
  })
})
