import { describe, expect, it } from 'vitest'
import { handleSmsoCallbackEdge, type SmsoCallbackEnv } from './smso-callback.ts'

const secret = 'high-entropy-callback-secret'
const request = (body: string, pathSecret = secret) =>
  new Request(`https://api.test/callbacks/smso/${pathSecret}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })

const environment = (matches = 1) => {
  const wakeups: unknown[] = []
  const env = {
    ENVIRONMENT: 'test',
    SMSO_CALLBACK_PATH_SECRET: secret,
    SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY: 'fingerprint-secret',
    DB: {
      prepare: () => ({
        bind: () => ({
          all: async () => ({
            results: Array.from({ length: matches }, (_, index) => ({
              intent_id: `nti_callback_${index}`
            }))
          })
        })
      })
    },
    BOOKING_EVENTS_QUEUE: {
      send: async (body: unknown) => {
        wakeups.push(body)
      }
    }
  } as unknown as SmsoCallbackEnv
  return { env, wakeups }
}

describe('SMSO.ro callback edge', () => {
  it('accepts a correlated hint without mutating delivery state and wakes polling', async () => {
    const { env, wakeups } = environment()
    const response = await handleSmsoCallbackEdge(
      request(
        'uuid=8a5d2f89-90a1-4b65-b2cb-ffb78c4f65aa&status=delivered&sent_at=2026-07-29+11%3A59%3A00'
      ),
      env
    )
    expect(response.status).toBe(202)
    expect(wakeups).toEqual([
      { version: 1, kind: 'notification-intent', intentId: 'nti_callback_0' }
    ])
  })

  it('does not reveal whether an unknown or ambiguous provider reference exists', async () => {
    for (const matches of [0, 2]) {
      const { env, wakeups } = environment(matches)
      const response = await handleSmsoCallbackEdge(
        request('uuid=8a5d2f89-90a1-4b65-b2cb-ffb78c4f65aa&status=sent'),
        env
      )
      expect(response.status).toBe(202)
      expect(wakeups).toEqual([])
    }
  })

  it('rejects a wrong path secret, method, shape, content type, and oversized body', async () => {
    const { env } = environment()
    expect(
      (await handleSmsoCallbackEdge(request('uuid=nope&status=sent', 'wrong'), env))
        .status
    ).toBe(404)
    expect(
      (await handleSmsoCallbackEdge(request('uuid=nope&status=sent', '%'), env)).status
    ).toBe(404)
    expect(
      (
        await handleSmsoCallbackEdge(
          new Request(`https://api.test/callbacks/smso/${secret}`),
          env
        )
      ).status
    ).toBe(405)
    expect(
      (await handleSmsoCallbackEdge(request('uuid=nope&status=sent'), env)).status
    ).toBe(400)
    expect(
      (
        await handleSmsoCallbackEdge(
          new Request(`https://api.test/callbacks/smso/${secret}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
          }),
          env
        )
      ).status
    ).toBe(415)
    expect(
      (await handleSmsoCallbackEdge(request(`uuid=${'a'.repeat(5000)}`), env)).status
    ).toBe(413)
  })
})
