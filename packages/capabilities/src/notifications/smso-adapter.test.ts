import { describe, expect, it } from 'vitest'
import { Effect, Redacted } from 'effect'
import { makeSmsoAdapter, type SmsoFetch } from './smso-adapter.ts'
import { makeLiveProviderAcceptancePersistence } from './smso-adapter.live.ts'
import { selectConfiguredSmsoAdapter } from './smso-provider.ts'

const request = {
  attemptId: 'pat_smso_fixture',
  intentId: 'nti_smso_fixture',
  routeId: 'prt_smso_fixture',
  provider: 'smso',
  channel: 'sms',
  locale: 'ro',
  purpose: 'appointment_confirmation',
  templateVersion: 'v2',
  idempotencyKey: 'idem_smso_fixture',
  destination: Redacted.make('+40722123456'),
  renderedBody: Redacted.make('Programare confirmata la BeeSolo pe 30 iulie la 10:00.'),
  credential: Redacted.make('api-key'),
  bodyFingerprint: `sha256:${'a'.repeat(64)}`
} as const

const adapter = (fetch: SmsoFetch) =>
  makeSmsoAdapter({
    apiKey: Redacted.make('api-key'),
    senderId: '1234',
    callbackUrl: Redacted.make('https://api.example/callbacks/smso/high-entropy'),
    fingerprintSecret: Redacted.make('fingerprint-secret'),
    providerAccountKey: 'smso-production',
    environment: 'production',
    timeoutMs: 2_000,
    fetch,
    now: () => '2026-07-29T12:00:00.000Z'
  })

describe('SMSO.ro provider adapter', () => {
  it('submits one form-encoded GSM-7 segment and captures acceptance cost', async () => {
    let outbound: Request | undefined
    const smso = adapter(async (input, init) => {
      outbound = new Request(input, init)
      return Response.json({
        status: 200,
        responseToken: '8a5d2f89-90a1-4b65-b2cb-ffb78c4f65aa',
        transaction_cost: 3.5
      })
    })

    const outcome = await Effect.runPromise(smso.submit(request))

    expect(outcome).toMatchObject({ _tag: 'accepted' })
    expect(outbound?.url).toBe('https://app.smso.ro/api/v1/send')
    expect(outbound?.headers.get('x-authorization')).toBe('api-key')
    expect(outbound?.headers.get('content-type')).toContain(
      'application/x-www-form-urlencoded'
    )
    expect(await outbound?.clone().text()).toBe(
      'to=%2B40722123456&sender=1234&body=Programare+confirmata+la+BeeSolo+pe+30+iulie+la+10%3A00.&type=transactional&webhook_status=https%3A%2F%2Fapi.example%2Fcallbacks%2Fsmso%2Fhigh-entropy'
    )
    expect(await Effect.runPromise(smso.readCosts('pat_smso_fixture'))).toEqual([
      expect.objectContaining({
        attemptId: 'pat_smso_fixture',
        provider: 'smso',
        amountMilliEuro: 35,
        currency: 'EUR',
        units: 1,
        source: 'response'
      })
    ])
  })

  it('rejects Unicode and a body over one GSM-7 segment before network I/O', async () => {
    let calls = 0
    const smso = adapter(async () => {
      calls += 1
      return Response.json({})
    })

    const unicode = await Effect.runPromise(
      smso.submit({ ...request, renderedBody: Redacted.make('Programare în curând') })
    )
    const tooLong = await Effect.runPromise(
      smso.submit({ ...request, renderedBody: Redacted.make('a'.repeat(161)) })
    )

    expect(unicode).toEqual({
      _tag: 'rejected',
      classification: 'terminal',
      code: 'provider_rejected'
    })
    expect(tooLong).toEqual(unicode)
    expect(calls).toBe(0)
  })

  it('classifies throttling separately and never retries ambiguous submission', async () => {
    const throttled = adapter(async () =>
      Response.json({ status: 429 }, { status: 429, headers: { 'Retry-After': '45' } })
    )
    expect(await Effect.runPromise(throttled.submit(request))).toEqual({
      _tag: 'throttled',
      retryAfterSeconds: 45
    })

    const undocumented409 = adapter(async () =>
      Response.json({ status: 409 }, { status: 409 })
    )
    expect(await Effect.runPromise(undocumented409.submit(request))).toEqual({
      _tag: 'ambiguous',
      observedAt: '2026-07-29T12:00:00.000Z'
    })

    let calls = 0
    const ambiguous = adapter(async () => {
      calls += 1
      throw new DOMException('timed out', 'AbortError')
    })
    expect(await Effect.runPromise(ambiguous.submit(request))).toEqual({
      _tag: 'ambiguous',
      observedAt: '2026-07-29T12:00:00.000Z'
    })
    expect(calls).toBe(1)
  })

  it('treats a shape-limited callback as a hint and polling as authoritative', async () => {
    const smso = adapter(async (input, init) => {
      expect(String(input)).toBe('https://app.smso.ro/api/v1/status')
      expect(init?.method).toBe('POST')
      expect(String(init?.body)).toBe(
        'responseToken=8a5d2f89-90a1-4b65-b2cb-ffb78c4f65aa'
      )
      return Response.json({
        status: 'delivered',
        sent_at: '2026-07-29 11:59:00',
        delivered_at: '2026-07-29 11:59:08'
      })
    })
    const raw =
      'uuid=8a5d2f89-90a1-4b65-b2cb-ffb78c4f65aa&status=delivered&sent_at=2026-07-29+11%3A59%3A00'

    const hint = await Effect.runPromise(
      smso.verifyCallback({
        provider: 'smso',
        receivedAt: '2026-07-29T12:00:00.000Z',
        rawBody: Redacted.make(raw)
      })
    )
    expect(hint).toMatchObject({ _tag: 'untrusted_hint' })

    const evidence = await Effect.runPromise(
      smso.query({
        provider: 'smso',
        attemptId: 'pat_smso_fixture',
        intentId: 'nti_smso_fixture',
        providerReference: Redacted.make('8a5d2f89-90a1-4b65-b2cb-ffb78c4f65aa'),
        providerReferenceFingerprint:
          hint._tag === 'untrusted_hint'
            ? hint.providerReferenceFingerprint
            : `sha256:${'0'.repeat(64)}`
      })
    )
    expect(evidence).toMatchObject({
      _tag: 'evidence',
      evidence: { source: 'query', status: 'delivered', trusted: true }
    })
  })

  it('rejects malformed or oversized callback hints', async () => {
    const smso = adapter(async () => Response.json({}))
    const malformed = await Effect.runPromise(
      smso.verifyCallback({
        provider: 'smso',
        receivedAt: '2026-07-29T12:00:00.000Z',
        rawBody: Redacted.make('uuid=nope&status=delivered')
      })
    )
    const oversized = await Effect.runPromise(
      smso.verifyCallback({
        provider: 'smso',
        receivedAt: '2026-07-29T12:00:00.000Z',
        rawBody: Redacted.make(`uuid=${'a'.repeat(5000)}`)
      })
    )
    expect(malformed).toEqual({ _tag: 'rejected', code: 'malformed_callback' })
    expect(oversized).toEqual({ _tag: 'rejected', code: 'payload_too_large' })
  })

  it('fails closed as needs_configuration outside local capture', async () => {
    const smso = makeSmsoAdapter({
      apiKey: Redacted.make(''),
      senderId: '',
      callbackUrl: Redacted.make(''),
      fingerprintSecret: Redacted.make(''),
      providerAccountKey: 'platform-smso',
      environment: 'production',
      timeoutMs: 1_000,
      fetch: async () => Response.json({})
    })
    expect(smso.runtimeState).toBe('needs_configuration')
    await expect(Effect.runPromise(smso.submit(request))).rejects.toMatchObject({
      reason: 'needs_configuration',
      code: 'provider_not_configured'
    })
  })

  it('rejects cross-provider queries and invalid provider-reference key versions', async () => {
    const smso = adapter(async () => Response.json({ status: 'delivered' }))
    await expect(
      Effect.runPromise(
        smso.query({
          provider: 'meta',
          attemptId: 'pat_smso_fixture',
          intentId: 'nti_smso_fixture',
          providerReference: Redacted.make('8a5d2f89-90a1-4b65-b2cb-ffb78c4f65aa'),
          providerReferenceFingerprint: `sha256:${'a'.repeat(64)}`
        })
      )
    ).rejects.toMatchObject({ code: 'provider_mismatch' })
    expect(
      selectConfiguredSmsoAdapter(
        {
          ENVIRONMENT: 'production',
          SMSO_API_KEY: 'key',
          SMSO_SENDER_ID: '1234',
          SMSO_CALLBACK_URL: 'https://api.test/callbacks/smso/secret',
          SMSO_PROVIDER_REFERENCE_ENCRYPTION_KEY: 'encryption',
          SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY: 'fingerprint',
          SMSO_PROVIDER_REFERENCE_KEY_VERSION: 'not-a-number'
        },
        '2026-07-29T12:00:00.000Z',
        async () => Response.json({})
      )
    ).toBeUndefined()
  })

  it('distinguishes polling timeout from other transport failures', async () => {
    const queryInput = async (fetch: SmsoFetch) => {
      const smso = adapter(fetch)
      const hint = await Effect.runPromise(
        smso.verifyCallback({
          provider: 'smso',
          receivedAt: '2026-07-29T12:00:00.000Z',
          rawBody: Redacted.make(
            'uuid=8a5d2f89-90a1-4b65-b2cb-ffb78c4f65aa&status=sent'
          )
        })
      )
      return smso.query({
        provider: 'smso',
        attemptId: 'pat_smso_fixture',
        intentId: 'nti_smso_fixture',
        providerReference: Redacted.make('8a5d2f89-90a1-4b65-b2cb-ffb78c4f65aa'),
        providerReferenceFingerprint:
          hint._tag === 'untrusted_hint'
            ? hint.providerReferenceFingerprint
            : `sha256:${'0'.repeat(64)}`
      })
    }
    await expect(
      Effect.runPromise(
        await queryInput(async () => {
          throw new DOMException('timed out', 'TimeoutError')
        })
      )
    ).rejects.toMatchObject({ reason: 'timeout', code: 'provider_timeout' })
    await expect(
      Effect.runPromise(
        await queryInput(async () => {
          throw new TypeError('DNS unavailable')
        })
      )
    ).rejects.toMatchObject({
      reason: 'transport',
      code: 'provider_transport_error'
    })
  })

  it('persists only encrypted token correlation and idempotent response cost facts', async () => {
    const statements: { sql: string; values: unknown[] }[] = []
    const db = {
      prepare: (sql: string) => {
        let boundValues: unknown[] = []
        const statement = {
          bind: (...values: unknown[]) => {
            boundValues = values
            statements.push({ sql, values })
            return statement
          },
          run: async () => ({}),
          all: async () => ({
            results: [
              {
                attempt_id: 'pat_smso_fixture',
                fingerprint: `sha256:${'f'.repeat(64)}`,
                boundValues
              }
            ]
          })
        }
        return statement
      },
      batch: async () => []
    }
    await Effect.runPromise(
      makeLiveProviderAcceptancePersistence({
        db: db as never,
        environment: 'production',
        encryptionSecret: 'provider-reference-encryption',
        keyVersion: 1
      })({
        shopId: 'shp_smso',
        intentId: 'nti_smso_fixture',
        attemptId: 'pat_smso_fixture',
        provider: 'smso',
        providerAccountKey: 'platform-smso',
        providerReferenceFingerprint: `sha256:${'f'.repeat(64)}`,
        protectedProviderReference: Redacted.make(
          '8a5d2f89-90a1-4b65-b2cb-ffb78c4f65aa'
        ),
        costFacts: [
          { amountMilliEuro: 35, units: 1, recordedAt: '2026-07-29T12:00:00.000Z' }
        ],
        acceptedAt: '2026-07-29T12:00:00.000Z'
      })
    )
    expect(statements).toHaveLength(3)
    expect(JSON.stringify(statements)).not.toContain(
      '8a5d2f89-90a1-4b65-b2cb-ffb78c4f65aa'
    )
    expect(statements[0]?.sql).toContain('protected_provider_references')
    expect(statements[1]?.sql).toContain('provider_messaging_costs')
    expect(statements[1]?.values).toContain(35)
  })

  it('rejects a response-token collision across attempts', async () => {
    const db = {
      prepare: () => {
        const statement = {
          bind: () => statement,
          run: async () => ({}),
          all: async () => ({
            results: [
              {
                attempt_id: 'pat_another_attempt',
                fingerprint: `sha256:${'f'.repeat(64)}`
              }
            ]
          })
        }
        return statement
      },
      batch: async () => []
    }
    await expect(
      Effect.runPromise(
        makeLiveProviderAcceptancePersistence({
          db: db as never,
          environment: 'production',
          encryptionSecret: 'provider-reference-encryption',
          keyVersion: 1
        })({
          shopId: 'shp_smso',
          intentId: 'nti_smso_fixture',
          attemptId: 'pat_smso_fixture',
          provider: 'smso',
          providerAccountKey: 'platform-smso',
          providerReferenceFingerprint: `sha256:${'f'.repeat(64)}`,
          protectedProviderReference: Redacted.make(
            '8a5d2f89-90a1-4b65-b2cb-ffb78c4f65aa'
          ),
          costFacts: [],
          acceptedAt: '2026-07-29T12:00:00.000Z'
        })
      )
    ).rejects.toMatchObject({ reason: 'provider_reference_collision' })
  })

  it.each([400, 401, 402, 403, 405, 422])(
    'classifies HTTP %s as a terminal provider rejection',
    async (status) => {
      const smso = adapter(async () => Response.json({ status }, { status }))
      expect(await Effect.runPromise(smso.submit(request))).toEqual({
        _tag: 'rejected',
        classification: 'terminal',
        code: 'provider_rejected'
      })
    }
  )

  it.each(['undelivered', 'expired', 'error'])(
    'maps authoritative %s polling to terminal failure evidence',
    async (status) => {
      const smso = adapter(async () =>
        Response.json({ status, sent_at: '2026-07-29 11:59:00' })
      )
      const outcome = await Effect.runPromise(
        smso.query({
          provider: 'smso',
          attemptId: 'pat_smso_fixture',
          intentId: 'nti_smso_fixture',
          providerReference: Redacted.make('8a5d2f89-90a1-4b65-b2cb-ffb78c4f65aa'),
          providerReferenceFingerprint: await Effect.runPromise(
            smso
              .verifyCallback({
                provider: 'smso',
                receivedAt: '2026-07-29T12:00:00.000Z',
                rawBody: Redacted.make(
                  `uuid=8a5d2f89-90a1-4b65-b2cb-ffb78c4f65aa&status=${status}`
                )
              })
              .pipe(
                Effect.map((hint) =>
                  hint._tag === 'untrusted_hint'
                    ? hint.providerReferenceFingerprint
                    : `sha256:${'0'.repeat(64)}`
                )
              )
          )
        })
      )
      expect(outcome).toMatchObject({
        _tag: 'evidence',
        evidence: { status: 'terminal_failure', trusted: true }
      })
    }
  )
})
