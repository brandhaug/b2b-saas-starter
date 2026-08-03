import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  createOperationsWorker,
  localOperatorFixture,
  type OperationsWorkerEnv
} from './operations-worker.ts'

const origin = 'http://localhost:3076'

describe('Operations local TanStack runtime', () => {
  let testD1: TestD1
  let env: OperationsWorkerEnv

  beforeAll(async () => {
    testD1 = await provisionTestD1()
    env = {
      DB: testD1.d1,
      ENVIRONMENT: 'test',
      MERCHANT_APP_ORIGIN: 'http://localhost:3072',
      OPERATIONS_APP_ORIGIN: origin,
      OPERATIONS_AUTH_SECRET:
        'isolated-operations-auth-secret-change-me-minimum-32-chars',
      OPERATIONS_AUTH_TRUSTED_ORIGINS: origin,
      OPERATIONS_LOCAL_SEED: 'enabled',
      OPERATIONS_SECURITY_CONTACT: 'security@operations.test'
    }
  }, 30_000)

  afterAll(async () => {
    await testD1?.dispose()
  })

  it('redirects an anonymous authoritative session read to sign-in', async () => {
    const response = await createOperationsWorker().fetch(
      new Request(`${origin}/api/operations/session`, {
        headers: { accept: 'application/json' },
        redirect: 'manual'
      }),
      env
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/sign-in')
  })

  it('authenticates and signs out through an isolated local binding', async () => {
    const form = new FormData()
    form.set('email', localOperatorFixture.email)
    form.set('password', localOperatorFixture.password)

    const passwordResponse = await createOperationsWorker().fetch(
      new Request(`${origin}/sign-in`, {
        method: 'POST',
        body: form,
        redirect: 'manual'
      }),
      env
    )

    expect(passwordResponse.status).toBe(303)
    expect(passwordResponse.headers.get('location')).toBe('/verify-totp')
    const challengeCookie = cookieFor(passwordResponse, 'operations.two_factor')

    const code = await authenticatorTotp(localOperatorFixture.totpAuthenticatorKey)
    const verificationForm = new FormData()
    verificationForm.set('code', code)
    const verificationResponse = await createOperationsWorker().fetch(
      new Request(`${origin}/verify-totp`, {
        method: 'POST',
        body: verificationForm,
        headers: { cookie: challengeCookie },
        redirect: 'manual'
      }),
      env
    )
    const sessionCookie = cookieFor(verificationResponse, 'operations.session_token')
    expect(verificationResponse.headers.get('location')).toBe('/')

    const signOutResponse = await createOperationsWorker().fetch(
      new Request(`${origin}/api/auth/sign-out`, {
        method: 'POST',
        headers: { cookie: sessionCookie, origin }
      }),
      env
    )
    expect(signOutResponse.ok).toBe(true)
    expect(signOutResponse.headers.getSetCookie().join(';')).toContain(
      'operations.session_token='
    )

    const protectedResponse = await createOperationsWorker().fetch(
      new Request(`${origin}/api/operations/session`, {
        headers: { cookie: sessionCookie },
        redirect: 'manual'
      }),
      env
    )
    expect(protectedResponse.status).toBe(303)
    expect(protectedResponse.headers.get('location')).toBe('/sign-in')
  })
})

const cookieFor = (response: Response, name: string): string => {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`))
  if (!cookie) throw new Error(`Missing ${name} cookie`)
  return cookie.split(';', 1)[0]!
}

const authenticatorTotp = async (base32Secret: string): Promise<string> => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = [...base32Secret.toUpperCase()]
    .map((character) => alphabet.indexOf(character).toString(2).padStart(5, '0'))
    .join('')
  const secret = Uint8Array.from(
    bits.match(/.{8}/g)?.map((byte) => Number.parseInt(byte, 2)) ?? []
  )
  const counter = new ArrayBuffer(8)
  new DataView(counter).setBigUint64(0, BigInt(Math.floor(Date.now() / 30_000)))
  const key = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter))
  const offset = digest.at(-1)! & 0x0f
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff)
  return (binary % 1_000_000).toString().padStart(6, '0')
}
