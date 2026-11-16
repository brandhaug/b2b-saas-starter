import { Effect, Schema } from 'effect'
import { withWideEventFacts } from '@b2b-saas-starter/logger'
import { describe, expect, it, vi } from 'vite-plus/test'

/**
 * What the two SSO halves do when the resolution itself fails. They disagree
 * on purpose (see the module docblock), and the difference is worth its own
 * file: the Seed-layer suite next door resolves for real, so this one binds a
 * D1 whose every statement fails, and the Live adapter reads through it.
 *
 * How the fail-open half can hide an outage:
 * - the failed read folds to "no decision" with nothing on the request's wide
 *   event, so a password sign-in that skipped enforcement looks routine;
 * - a persistent failure disables require-SSO for every domain with no
 *   operational signal to alert on.
 */
vi.mock('cloudflare:workers', async (importOriginal) => {
  const original = await importOriginal<{ readonly env: object }>()
  function unavailable() {
    return Promise.reject(new Error('D1_ERROR: storage unavailable'))
  }
  const statement = {
    bind: () => statement,
    all: unavailable,
    raw: unavailable,
    first: unavailable,
    run: unavailable
  }
  return {
    ...original,
    env: {
      ...original.env,
      DB: { prepare: () => statement, batch: unavailable, exec: unavailable }
    }
  }
})

const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

const { enforceSsoRequired, refuseDisabledConnection } =
  await import('./sso-sign-in-gate')

const decodeLine = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))

/** The gates are Effects; the assertions are promise ones. */
function run(gate: Effect.Effect<Response | null>) {
  let facts = {}
  // oxlint-disable-next-line starter/no-run-promise-in-tests -- the deliberate promise boundary the auth catchall itself crosses
  return Effect.runPromise(
    withWideEventFacts(gate, (recorded) =>
      Effect.sync(() => {
        facts = { ...recorded }
      })
    )
  ).then((response) => ({ response, facts }))
}

function signInRequest(pathname: string, body: unknown): Request {
  return new Request(`http://localhost:3071/api/auth${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

function errorLines() {
  return errors.mock.calls.map(([line]) => decodeLine(String(line)))
}

describe('an unavailable SSO resolution', () => {
  it('fails open for the credential sign-in and records the skipped enforcement', async () => {
    errors.mockClear()
    const { response, facts } = await run(
      enforceSsoRequired(
        signInRequest('/sign-in/email', { email: 'someone@acme.test' }),
        { method: 'POST', pathname: '/api/auth/sign-in/email' }
      )
    )

    expect(response).toBeNull()
    expect(facts).toMatchObject({
      skipReason: 'sso_required_unavailable',
      capability: 'workspace-sso-connections'
    })
    expect(errorLines()).toEqual([
      expect.objectContaining({
        event: 'operations.failure',
        signal: 'sso_enforcement_unavailable',
        evidence: expect.objectContaining({
          operation: 'SsoSignInGate.enforceSsoRequired',
          capability: 'workspace-sso-connections'
        })
      })
    ])
  })

  it('fails closed for the SSO sign-in: an unreadable connection never starts the IdP flow', async () => {
    const { response } = await run(
      refuseDisabledConnection(
        signInRequest('/sign-in/sso', { email: 'someone@acme.test' }),
        { method: 'POST', pathname: '/api/auth/sign-in/sso' }
      )
    )

    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toMatchObject({
      code: 'sso_connection_unavailable'
    })
  })
})
