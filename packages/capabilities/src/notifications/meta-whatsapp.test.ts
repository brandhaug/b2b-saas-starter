import { describe, expect, it, vi } from 'vitest'
import { Effect, Redacted } from 'effect'
import {
  classifyMetaError,
  classifyMetaPricing,
  makeD1MetaReferenceProtector,
  makeMetaWhatsAppSubmission
} from './meta-whatsapp.ts'

const request = {
  attemptId: 'pat_fixture_ro_confirmation',
  intentId: 'nti_fixture_ro_confirmation',
  routeId: 'prt_fixture_ro_confirmation',
  provider: 'meta' as const,
  channel: 'whatsapp' as const,
  locale: 'ro' as const,
  purpose: 'appointment_confirmation' as const,
  templateVersion: 'v1',
  templateKey: 'beesolo_appointment_confirmation_ro_v1',
  templateParameters: [
    Redacted.make('Atelier Luna'),
    Redacted.make('29 iulie 2026'),
    Redacted.make('12:30'),
    Redacted.make('Strada Florilor 1'),
    Redacted.make('ABC123'),
    Redacted.make('https://bsolo.ro/c/ABC123')
  ],
  idempotencyKey: 'idem_fixture_ro_confirmation',
  destination: Redacted.make('+40722123456'),
  renderedBody: Redacted.make('Programarea este confirmată.'),
  bodyFingerprint:
    'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
}

describe('Meta WhatsApp submission', () => {
  it('submits the exact controlled template envelope and protects the wamid before acceptance', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ messages: [{ id: 'wamid.HBgLMETA' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    )
    const protectReference = vi.fn(
      async () =>
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
    const submit = makeMetaWhatsAppSubmission({
      accessToken: Redacted.make('meta-token'),
      phoneNumberId: '123456789',
      graphApiVersion: 'v23.0',
      providerAccountKey: 'platform-meta',
      fetch,
      protectReference,
      now: () => '2026-07-29T09:00:00.000Z'
    })

    await expect(Effect.runPromise(submit(request))).resolves.toEqual({
      _tag: 'accepted',
      providerReferenceFingerprint:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      acceptedAt: '2026-07-29T09:00:00.000Z'
    })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = (fetch.mock.calls as unknown as [[string, RequestInit]])[0]!
    expect(url).toBe('https://graph.facebook.com/v23.0/123456789/messages')
    expect(init.headers).toEqual({
      Authorization: 'Bearer meta-token',
      'Content-Type': 'application/json'
    })
    expect(JSON.parse(String(init.body))).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+40722123456',
      type: 'template',
      template: {
        name: 'beesolo_appointment_confirmation_ro_v1',
        language: { code: 'ro' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Atelier Luna' },
              { type: 'text', text: '29 iulie 2026' },
              { type: 'text', text: '12:30' },
              { type: 'text', text: 'Strada Florilor 1' },
              { type: 'text', text: 'ABC123' },
              { type: 'text', text: 'https://bsolo.ro/c/ABC123' }
            ]
          }
        ]
      }
    })
    expect(protectReference).toHaveBeenCalledWith({
      attemptId: request.attemptId,
      providerAccountKey: 'platform-meta',
      providerReference: 'wamid.HBgLMETA'
    })
  })

  it('treats transport timeouts and unknown provider errors as ambiguous', async () => {
    const timeoutSubmit = makeMetaWhatsAppSubmission({
      accessToken: Redacted.make('meta-token'),
      phoneNumberId: '123456789',
      graphApiVersion: 'v23.0',
      providerAccountKey: 'platform-meta',
      fetch: vi.fn(async () => {
        throw new DOMException('timed out', 'AbortError')
      }),
      protectReference: vi.fn(),
      now: () => '2026-07-29T09:00:00.000Z'
    })
    const unknownErrorSubmit = makeMetaWhatsAppSubmission({
      accessToken: Redacted.make('meta-token'),
      phoneNumberId: '123456789',
      graphApiVersion: 'v23.0',
      providerAccountKey: 'platform-meta',
      fetch: vi.fn(async () =>
        Response.json({ error: { code: 999999 } }, { status: 400 })
      ),
      protectReference: vi.fn(),
      now: () => '2026-07-29T09:00:00.000Z'
    })

    await expect(Effect.runPromise(timeoutSubmit(request))).resolves.toEqual({
      _tag: 'ambiguous',
      observedAt: '2026-07-29T09:00:00.000Z'
    })
    await expect(Effect.runPromise(unknownErrorSubmit(request))).resolves.toEqual({
      _tag: 'ambiguous',
      observedAt: '2026-07-29T09:00:00.000Z'
    })
  })

  it('preserves Meta retry-after guidance for throttling', async () => {
    const submit = makeMetaWhatsAppSubmission({
      accessToken: Redacted.make('meta-token'),
      phoneNumberId: '123456789',
      graphApiVersion: 'v23.0',
      providerAccountKey: 'platform-meta',
      fetch: vi.fn(
        async () =>
          new Response('{}', { status: 429, headers: { 'retry-after': '73' } })
      ),
      protectReference: vi.fn(),
      now: () => '2026-07-29T09:00:00.000Z'
    })
    await expect(Effect.runPromise(submit(request))).resolves.toEqual({
      _tag: 'throttled',
      retryAfterSeconds: 73
    })
  })

  it('returns the provider code and effective policy version for auditable rejection', async () => {
    const submit = makeMetaWhatsAppSubmission({
      accessToken: Redacted.make('meta-token'),
      phoneNumberId: '123456789',
      graphApiVersion: 'v23.0',
      providerAccountKey: 'platform-meta',
      fetch: vi.fn(async () =>
        Response.json({ error: { code: 131026 } }, { status: 400 })
      ),
      protectReference: vi.fn(),
      now: () => '2026-07-29T09:00:00.000Z'
    })

    await expect(Effect.runPromise(submit(request))).resolves.toEqual({
      _tag: 'rejected',
      classification: 'terminal',
      code: 'provider_rejected',
      providerCode: 131026,
      classificationPolicyVersion: 'meta-errors-2026-07-29'
    })
  })
})

describe('effective-dated Meta policy', () => {
  it('classifies only known codes and pricing facts under an explicit policy version', () => {
    expect(classifyMetaError(131026, '2026-07-29T09:00:00.000Z')).toEqual({
      policyVersion: 'meta-errors-2026-07-29',
      classification: 'terminal'
    })
    expect(classifyMetaError(130429, '2026-07-29T09:00:00.000Z')).toEqual({
      policyVersion: 'meta-errors-2026-07-29',
      classification: 'retryable'
    })
    expect(classifyMetaError(999999, '2026-07-29T09:00:00.000Z')).toBeNull()
    expect(
      classifyMetaPricing(
        { billable: true, pricing_model: 'PMP', category: 'utility' },
        '2026-07-29T09:00:00.000Z'
      )
    ).toEqual({
      policyVersion: 'meta-pricing-2026-07-29',
      billable: true,
      category: 'utility',
      pricingModel: 'PMP'
    })
  })
})

describe('Meta provider-reference correlation', () => {
  it('persists encrypted correlation and verifies the attempt owns it before acceptance', async () => {
    const statements: { sql: string; values: unknown[] }[] = []
    const db = {
      prepare: (sql: string) => {
        let values: unknown[] = []
        const statement = {
          bind: (...bound: unknown[]) => {
            values = bound
            statements.push({ sql, values })
            return statement
          },
          run: async () => ({ success: true }),
          first: async () => ({ attempt_id: 'pat_fixture_ro_confirmation' })
        }
        return statement
      }
    }
    const protect = makeD1MetaReferenceProtector({
      db: db as never,
      encryptionSecret: 'meta-reference-encryption',
      fingerprintSecret: 'meta-reference-fingerprint',
      keyVersion: 3,
      environment: 'production'
    })

    await expect(
      protect({
        attemptId: 'pat_fixture_ro_confirmation',
        providerAccountKey: 'platform-meta',
        providerReference: 'wamid.HBgLMETA-SECRET'
      })
    ).resolves.toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(statements).toHaveLength(2)
    expect(statements[0]?.sql).toContain('protected_provider_references')
    expect(statements[1]?.sql).toContain('attempt_id = ?')
    expect(JSON.stringify(statements)).not.toContain('wamid.HBgLMETA-SECRET')
  })
})
