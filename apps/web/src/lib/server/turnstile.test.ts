import { describe, expect, it } from 'vitest'
import {
  gateTurnstileProtectedRequest,
  verifyTurnstileToken,
  type FetchLike
} from './turnstile'

/**
 * Hand-rolled fetch double: records each call's FormData body so assertions
 * never need mock typings or type assertions.
 */
function makeFetchDouble(options?: {
  readonly body?: unknown
  readonly status?: number
  readonly reject?: boolean
}) {
  const bodies: Array<FormData | null> = []
  let count = 0
  async function fetchDouble(
    _input: Parameters<FetchLike>[0],
    init?: Parameters<FetchLike>[1]
  ): Promise<Response> {
    count += 1
    bodies.push(init?.body instanceof FormData ? init.body : null)
    if (options?.reject) throw new Error('network down')
    return new Response(JSON.stringify(options?.body ?? {}), {
      status: options?.status ?? 200
    })
  }
  return {
    fetch: (input: Parameters<FetchLike>[0], init?: Parameters<FetchLike>[1]) =>
      fetchDouble(input, init),
    bodies,
    count: () => count
  }
}

function signUpPost(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3071/api/auth/sign-up/email', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Ada', email: 'a@b.co', password: 'correct-horse' })
  })
}

describe('gateTurnstileProtectedRequest', () => {
  it('lets non-sign-up requests through untouched', async () => {
    const request = new Request('http://localhost:3071/api/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({})
    })
    await expect(
      gateTurnstileProtectedRequest(request, { secret: 'secret' })
    ).resolves.toBeUndefined()
  })

  it('lets sign-up through when no secret is configured', async () => {
    await expect(
      gateTurnstileProtectedRequest(signUpPost(), { secret: undefined })
    ).resolves.toBeUndefined()
  })

  it('rejects configured sign-up with a missing token header, closed', async () => {
    const response = await gateTurnstileProtectedRequest(signUpPost(), {
      secret: 'secret'
    })
    expect(response?.status).toBe(400)
    expect(await response?.json()).toMatchObject({ code: 'TURNSTILE_FAILED' })
  })

  it('rejects configured sign-up with an invalid token, closed', async () => {
    const fetchDouble = makeFetchDouble({ body: { success: false } })
    const response = await gateTurnstileProtectedRequest(
      signUpPost({ 'x-turnstile-token': 'bad' }),
      { secret: 'secret', fetchImpl: fetchDouble.fetch }
    )
    expect(response?.status).toBe(400)
    expect(fetchDouble.count()).toBe(1)
  })

  it('passes valid sign-ups to the auth handler with no response', async () => {
    const response = await gateTurnstileProtectedRequest(
      signUpPost({ 'x-turnstile-token': 'tok' }),
      {
        secret: 'secret',
        fetchImpl: makeFetchDouble({ body: { success: true } }).fetch
      }
    )
    expect(response).toBeUndefined()
  })
})

describe('verifyTurnstileToken', () => {
  it('is skipped when no secret is configured', async () => {
    const fetchDouble = makeFetchDouble({ body: { success: true } })
    const result = await verifyTurnstileToken({
      secret: undefined,
      token: 'tok',
      fetchImpl: fetchDouble.fetch
    })
    expect(result).toEqual({ outcome: 'skipped' })
    expect(fetchDouble.count()).toBe(0)
  })

  it('fails closed without a network call when configured but the token is missing', async () => {
    const fetchDouble = makeFetchDouble({ body: { success: true } })
    const result = await verifyTurnstileToken({
      secret: 'secret',
      token: undefined,
      fetchImpl: fetchDouble.fetch
    })
    expect(result.outcome).toBe('failed')
    expect(fetchDouble.count()).toBe(0)
  })

  it('passes when Cloudflare confirms the token', async () => {
    const fetchDouble = makeFetchDouble({ body: { success: true } })
    const result = await verifyTurnstileToken({
      secret: 'secret',
      token: 'tok',
      fetchImpl: fetchDouble.fetch
    })
    expect(result).toEqual({ outcome: 'passed' })
    expect(fetchDouble.bodies[0]?.get('response')).toBe('tok')
  })

  it('fails when Cloudflare rejects the token', async () => {
    const result = await verifyTurnstileToken({
      secret: 'secret',
      token: 'bad',
      fetchImpl: makeFetchDouble({
        body: { success: false, 'error-codes': ['invalid-input-response'] }
      }).fetch
    })
    expect(result).toEqual({ outcome: 'failed', reason: 'invalid-input-response' })
  })

  it('fails when the verification endpoint itself errors', async () => {
    const result = await verifyTurnstileToken({
      secret: 'secret',
      token: 'tok',
      fetchImpl: makeFetchDouble({ reject: true }).fetch
    })
    expect(result.outcome).toBe('failed')
  })

  it('forwards the client IP when provided', async () => {
    const fetchDouble = makeFetchDouble({ body: { success: true } })
    await verifyTurnstileToken({
      secret: 'secret',
      token: 'tok',
      remoteIp: '203.0.113.9',
      fetchImpl: fetchDouble.fetch
    })
    expect(fetchDouble.bodies[0]?.get('remoteip')).toBe('203.0.113.9')
  })
})
