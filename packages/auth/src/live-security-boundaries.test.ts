import { oauthClient, user } from '@b2b-saas-starter/db/schema'
import { validateCimdMetadata, validateClientIdUrl } from '@better-auth/cimd'
import { adminSystemRole } from '@b2b-saas-starter/db/enums'
import { eq } from 'drizzle-orm'
import { Effect, type Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest'
import { Auth } from './index.ts'
import { testMcpConfig } from './test-mcp.ts'
import {
  buildAuthLayer,
  cookieHeader,
  cookiePairs,
  enableTotp,
  provisionAuthD1,
  signUpSession,
  type AuthService,
  type ProvisionedAuthD1
} from './test-auth-layer.ts'

let provisioned: ProvisionedAuthD1
let authLayer: Layer.Layer<AuthService>
const links = new Map<string, string>()
const codes = new Map<string, string>()

// oxlint-disable-next-line effect/noTestLifecycleHooks -- owns the local D1 process
beforeAll(
  () =>
    provisionAuthD1().then((database) => {
      provisioned = database
      authLayer = buildAuthLayer(provisioned.db, {
        mcp: {
          ...testMcpConfig(),
          fetchClientMetadataResource: (input) =>
            Promise.resolve(
              Response.json({
                client_id: new Request(input).url,
                client_name: 'Trusted product',
                client_uri: 'https://untrusted-client.example.com',
                redirect_uris: ['http://127.0.0.1:33418/oauth/callback'],
                token_endpoint_auth_method: 'none',
                grant_types: ['authorization_code'],
                response_types: ['code']
              })
            )
        },
        emails: {
          sendVerificationEmail: (data) => {
            links.set(data.user.email, data.url)
            return Promise.resolve()
          },
          sendOneTimeCode: (data) => {
            codes.set(data.email, data.otp)
            return Promise.resolve()
          },
          sendResetPassword: () => Promise.resolve(),
          sendMagicLink: () => Promise.resolve(),
          sendPasswordResetConfirmation: () => Promise.resolve()
        }
      })
      return null
    }),
  60_000
)

// oxlint-disable-next-line effect/noTestLifecycleHooks -- disposes the local D1 process
afterAll(() => provisioned.dispose())

function run<A, E>(effect: Effect.Effect<A, E, AuthService>) {
  return Effect.provide(effect, authLayer)
}

describe('pinned auth security boundaries', () => {
  it('CIMD admission leaves internal absolute hostnames to the transport', () => {
    expect(validateClientIdUrl('https://localhost./m')).not.toBeNull()
    expect(validateClientIdUrl('https://box.internal./m')).toBeNull()
    expect(validateClientIdUrl('https://intranet./m')).toBeNull()
  })

  it('CIMD requires a name and binds client_uri to the client ID origin', () => {
    const clientId = 'https://untrusted-client.example.com/m'
    const metadata = {
      client_id: clientId,
      redirect_uris: ['http://127.0.0.1/callback']
    }
    expect(
      validateCimdMetadata(clientId, metadata, { metadataProfile: 'mcp-2026-07-28' })
    ).toMatchObject({ valid: false, error: 'client_name must be a non-empty string' })
    expect(
      validateCimdMetadata(
        clientId,
        {
          ...metadata,
          client_name: 'Trusted product',
          client_uri: 'https://trusted.example.com'
        },
        { metadataProfile: 'mcp-2026-07-28' }
      )
    ).toMatchObject({
      valid: false,
      error: expect.stringContaining('must have the same origin as client_id')
    })
  })

  it.live(
    'CIMD stores a self-asserted product name for consent',
    () =>
      run(
        Effect.gen(function* () {
          const auth = yield* Auth.Tag
          const { headers } = yield* signUpSession('consent@security.test')
          const clientId =
            'https://untrusted-client.example.com/oauth/client-metadata.json'
          const authorize = new URL('http://localhost:3071/api/auth/oauth2/authorize')
          authorize.search = new URLSearchParams({
            client_id: clientId,
            redirect_uri: 'http://127.0.0.1:33418/oauth/callback',
            response_type: 'code',
            scope: 'mcp:read',
            state: 'test',
            code_challenge: 'UZniAYhXZU8-4e7438nGpsqTBRg7vbGm2_jWHK56vvQ',
            code_challenge_method: 'S256',
            resource: 'http://localhost:8787/mcp'
          }).toString()
          const response = yield* Effect.promise(() =>
            auth.instance.handler(new Request(authorize, { headers }))
          )
          expect(response.status).toBe(302)
          expect(response.headers.get('location')).toContain('/oauth/consent')
          const [stored] = yield* Effect.promise(() =>
            provisioned.db
              .select()
              .from(oauthClient)
              .where(eq(oauthClient.clientId, clientId))
          )
          expect(stored).toMatchObject({
            name: 'Trusted product',
            uri: 'https://untrusted-client.example.com'
          })
        })
      ),
    { timeout: 30_000 }
  )

  it.live(
    'verification consume creates a mailbox-only session even with TOTP enabled',
    () =>
      run(
        Effect.gen(function* () {
          const auth = yield* Auth.Tag
          const email = 'verification-totp@security.test'
          const signup = yield* signUpSession(email)
          yield* enableTotp(signup)
          const link = links.get(email)
          expect(link).toBeTruthy()
          const verified = yield* Effect.promise(() =>
            auth.instance.handler(new Request(link ?? ''))
          )
          expect(verified.status).toBeLessThan(400)
          const session = yield* auth.api.getSession({
            headers: new Headers({
              cookie: cookieHeader(cookiePairs(verified.headers))
            })
          })
          expect(session?.user.twoFactorEnabled).toBe(true)
          expect(session?.user.emailVerified).toBe(true)

          // Core verification links do not create another session after verification.
          const replay = yield* Effect.promise(() =>
            auth.instance.handler(new Request(link ?? ''))
          )
          expect(replay.headers.getSetCookie().join(' ')).not.toContain(
            'session_token='
          )
          links.delete(email)
          yield* auth.api.sendVerificationEmail({ body: { email } })
          expect(links.has(email)).toBe(false)

          // OTP verification, unlike link verification, accepts already-verified accounts.
          yield* auth.api.sendVerificationOTP({
            body: { email, type: 'email-verification' }
          })
          expect(codes.get(email)).toBeTruthy()
          const otp = yield* auth.full.verifyEmailOTP({
            body: { email, otp: codes.get(email) ?? '' }
          })
          const otpSession = yield* auth.api.getSession({
            headers: new Headers({ cookie: cookieHeader(cookiePairs(otp.headers)) })
          })
          expect(otpSession?.user.twoFactorEnabled).toBe(true)
          expect(otpSession?.user.id).toBe(signup.userId)
        })
      ),
    { timeout: 30_000 }
  )

  it.live(
    'ban revokes an existing cookie session with cookie caching disabled',
    () =>
      run(
        Effect.gen(function* () {
          const auth = yield* Auth.Tag
          const admin = yield* signUpSession('admin@security.test')
          const target = yield* signUpSession('banned@security.test')
          yield* Effect.promise(() =>
            provisioned.db
              .update(user)
              .set({ role: adminSystemRole })
              .where(eq(user.id, admin.userId))
          )
          expect(yield* auth.api.getSession({ headers: target.headers })).not.toBeNull()
          yield* auth.api.banUser({
            body: { userId: target.userId },
            headers: admin.headers
          })
          expect(yield* auth.api.getSession({ headers: target.headers })).toBeNull()
        })
      ),
    { timeout: 30_000 }
  )

  it.live(
    'records routing of non-canonical spellings before the web guards',
    () =>
      run(
        Effect.gen(function* () {
          const auth = yield* Auth.Tag
          for (const path of [
            '/change-password',
            '/two-factor/enable',
            '/sign-in/email',
            '/sign-in/email-otp'
          ]) {
            for (const variant of [
              path,
              `${path}/`,
              path.replace('/', '//'),
              path.replace('/', '/%2f'),
              path.toUpperCase()
            ]) {
              const response = yield* Effect.promise(() =>
                auth.instance.handler(
                  new Request(`http://localhost:3071/api/auth${variant}`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: '{}'
                  })
                )
              )
              // Better Auth keeps better-call's strict trailing-slash default.
              if (variant === path) {
                expect(response.status).toBe(400)
              } else {
                expect(response.status).toBe(404)
              }
            }
          }
        })
      ),
    { timeout: 30_000 }
  )
})
