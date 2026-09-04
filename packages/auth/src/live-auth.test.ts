import { createDrizzleDb, type DrizzleDatabase } from '@b2b-saas-starter/db/client'
import {
  MCP_WORKSPACE_ID_CLAIM,
  MCP_WORKSPACE_ROLE_CLAIM,
  MCP_WORKSPACE_SLUG_CLAIM
} from '@b2b-saas-starter/authz/mcp-access-token'
import {
  oauthClient,
  oauthClientResource,
  user,
  verification,
  workspaceInvitations,
  workspaces
} from '@b2b-saas-starter/db/schema'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { Effect, Layer, Schema } from 'effect'
import { eq } from 'drizzle-orm'
import { type Service } from 'effectful-better-auth'
import { createLocalJWKSet, jwtVerify } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'
import {
  Auth,
  AuthConfig,
  MCP_CONSENT_PAGE,
  MCP_WORKSPACE_SELECTED_HEADER,
  type AuthEmailSender,
  type AuthOptions
} from './index.ts'
import { decodeUriSecret } from './test-totp.ts'
import { testMcpConfig } from './test-mcp.ts'

// The organization plugin is only observable through a real database: its
// `modelName` overrides, its `additionalFields`, and its role table all resolve
// inside Better Auth and reach D1 as SQL. Asserting the options object instead
// would pass even if no endpoint ever found a table, so this suite drives
// `Auth.api` against a local D1 (workerd) with every committed migration
// applied.

type AuthService = Service<AuthOptions>

let testD1: TestD1
let db: DrizzleDatabase
let authLayer: Layer.Layer<AuthService>

// The lifecycle-email port, capturing what Better Auth hands it instead of
// sending: these tests assert on the URLs and the calls, not on delivery.
const sentEmails: Array<{
  readonly kind: 'reset' | 'verification' | 'magic-link'
  readonly email: string
  readonly url: string
}> = []

// The email-otp codes, captured so a test can play the mailbox: the code is
// the payload, and the lockout test needs the real one to prove a correct
// fourth attempt still dies.
const sentCodes: Array<{
  readonly email: string
  readonly otp: string
  readonly type: 'sign-in' | 'email-verification' | 'forget-password' | 'change-email'
}> = []

const capturingEmailSender: AuthEmailSender = {
  // Destructured off `data` rather than the parameter: `user` up here is the
  // imported table.
  sendResetPassword: (data) => {
    sentEmails.push({ kind: 'reset', email: data.user.email, url: data.url })
    return Promise.resolve()
  },
  sendVerificationEmail: (data) => {
    sentEmails.push({
      kind: 'verification',
      email: data.user.email,
      url: data.url
    })
    return Promise.resolve()
  },
  sendOneTimeCode: (data) => {
    sentCodes.push({ email: data.email, otp: data.otp, type: data.type })
    return Promise.resolve()
  },
  sendMagicLink: (data) => {
    sentEmails.push({ kind: 'magic-link', email: data.email, url: data.url })
    return Promise.resolve()
  }
}

// oxlint-disable-next-line effect/noTestLifecycleHooks -- owns the workerd process
beforeAll(
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        testD1 = yield* Effect.promise(() => provisionTestD1())
        db = createDrizzleDb(testD1.d1)
        authLayer = Auth.layer.pipe(
          Layer.provide(
            Layer.sync(AuthConfig)(() => ({
              db,
              secret: 'test-secret-at-least-32-characters-long',
              baseURL: 'http://localhost:3071',
              trustedOrigins: [],
              emails: capturingEmailSender,
              // No provider configured: the Local Auth Path shape, unchanged.
              socialProviders: {},
              accountHooks: {
                onAccountLinked: () => Promise.resolve(),
                onAccountUnlinked: () => Promise.resolve()
              },
              // Local-mode stance: the gate stays off in tests, matching dev.
              requireEmailVerification: false,
              // No execution context in a test: run the detached send inline
              // and keep its rejection off the isolate's unhandled path.
              runBackground: (promise) => {
                void promise.catch(() => undefined)
              },
              mcp: testMcpConfig()
            }))
          )
        )
      })
    ),
  60_000
)

// oxlint-disable-next-line effect/noTestLifecycleHooks -- disposes the workerd process
afterAll(() => testD1.dispose())

function run<A, E>(effect: Effect.Effect<A, E, AuthService>) {
  return Effect.runPromise(Effect.provide(effect, authLayer))
}

/** The plugin needs an existing user to own the workspace it creates. */
function seedUser(id: string, email: string) {
  return Effect.promise(() => db.insert(user).values({ id, email, name: email }).run())
}

/**
 * A real session cookie. `createOrganization` accepts a `userId` body field and
 * runs headerless, but the invitation and permission endpoints are
 * `requireHeaders`, so those tests sign a user up and reuse the cookie Better
 * Auth sets. `instance` is the escape hatch for the raw headers — the effectful
 * `api` collapses to the data branch.
 */
function signUpSession(email: string) {
  return Effect.gen(function* () {
    const auth = yield* Auth.Tag
    const { headers, response } = yield* Effect.promise(() =>
      auth.instance.api.signUpEmail({
        body: { email, name: email, password: 'correct-horse-battery-staple' },
        returnHeaders: true
      })
    )
    // Sign-up can set more than one cookie (the framework bridge forwards
    // each); keep every name=value pair, not just the first header.
    const setCookies = headers.getSetCookie()
    if (setCookies.length === 0) {
      return yield* Effect.die(`sign-up set no cookie for ${email}`)
    }
    const cookieHeader = setCookies.map((cookie) => cookie.split(';')[0]).join('; ')
    return {
      headers: new Headers({ cookie: cookieHeader }),
      /** The sign-up cookies as `name=value` pairs, for merging with later rotations. */
      cookiePairs: cookieHeader.split('; ').filter(Boolean),
      userId: response.user.id
    }
  })
}

describe('organization plugin', () => {
  it('creates a workspace through the remapped organization model', () =>
    run(
      Effect.gen(function* () {
        yield* seedUser('usr_acme_owner', 'owner@acme.test')
        const auth = yield* Auth.Tag

        const created = yield* auth.api.createOrganization({
          body: { name: 'Acme', slug: 'acme', userId: 'usr_acme_owner' }
        })

        expect(created.slug).toBe('acme')

        const rows = yield* Effect.promise(() =>
          db.select().from(workspaces).where(eq(workspaces.slug, 'acme'))
        )
        expect(rows).toHaveLength(1)
        expect(rows[0]?.name).toBe('Acme')
      })
    ))

  it('carries planId and updatedAt as organization additional fields', () =>
    run(
      Effect.gen(function* () {
        yield* seedUser('usr_plan_owner', 'owner@plan.test')
        const auth = yield* Auth.Tag

        const created = yield* auth.api.createOrganization({
          body: { name: 'Plan Co', slug: 'plan-co', userId: 'usr_plan_owner' }
        })

        // A column the plugin does not declare is stripped from every endpoint
        // response, so reading these back proves they are declared, not merely
        // defaulted by SQLite.
        expect(created.planId).toBe('starter')
        expect(created.updatedAt).toBeInstanceOf(Date)
      })
    ))

  it('creates an invitation through the remapped invitation model', () =>
    run(
      Effect.gen(function* () {
        const { headers } = yield* signUpSession('inviter@invite.test')
        const auth = yield* Auth.Tag

        const workspace = yield* auth.api.createOrganization({
          body: { name: 'Invite Co', slug: 'invite-co' },
          headers
        })
        const invitation = yield* auth.api.createInvitation({
          body: {
            email: 'newcomer@invite.test',
            role: 'member',
            organizationId: workspace.id
          },
          headers
        })

        expect(invitation.email).toBe('newcomer@invite.test')

        const rows = yield* Effect.promise(() =>
          db
            .select()
            .from(workspaceInvitations)
            .where(eq(workspaceInvitations.email, 'newcomer@invite.test'))
        )
        expect(rows).toHaveLength(1)
        expect(rows[0]?.status).toBe('pending')
        expect(rows[0]?.workspaceId).toBe(workspace.id)
      })
    ))

  it('answers hasPermission from the starter statement set', () =>
    run(
      Effect.gen(function* () {
        const { headers } = yield* signUpSession('owner@perm.test')
        const auth = yield* Auth.Tag

        const workspace = yield* auth.api.createOrganization({
          body: { name: 'Perm Co', slug: 'perm-co' },
          headers
        })
        // `apiToken` is a starter resource. The plugin's own statement set has
        // no such resource, so a true answer can only come from packages/authz.
        const result = yield* auth.api.hasPermission({
          body: {
            organizationId: workspace.id,
            permissions: { apiToken: ['create'] }
          },
          headers
        })

        expect(result.success).toBe(true)
      })
    ))

  // The two below guard configuration that is correct today; they exist to fail
  // if it is changed, not because they drove it.

  it('keeps the plugin default statements working under the starter roles', () =>
    run(
      Effect.gen(function* () {
        const owner = yield* signUpSession('owner@roles.test')
        const member = yield* signUpSession('member@roles.test')
        const auth = yield* Auth.Tag

        const workspace = yield* auth.api.createOrganization({
          body: { name: 'Roles Co', slug: 'roles-co' },
          headers: owner.headers
        })
        yield* auth.api.addMember({
          body: {
            userId: member.userId,
            organizationId: workspace.id,
            role: 'member'
          }
        })

        const ownerUpdates = yield* auth.api.hasPermission({
          body: {
            organizationId: workspace.id,
            permissions: { organization: ['update'] }
          },
          headers: owner.headers
        })
        const memberUpdates = yield* auth.api.hasPermission({
          body: {
            organizationId: workspace.id,
            permissions: { organization: ['update'] }
          },
          headers: member.headers
        })
        const memberReadsNotifications = yield* auth.api.hasPermission({
          body: {
            organizationId: workspace.id,
            permissions: { notification: ['read'] }
          },
          headers: member.headers
        })

        // `organization:update` is the plugin's own statement — a custom role
        // table that dropped it would break the plugin's endpoints, not just a
        // starter permission. `notification:read` is the starter's, and only
        // `memberRole` grants it. Together they prove the two sets merged
        // rather than one replacing the other.
        expect(ownerUpdates.success).toBe(true)
        expect(memberUpdates.success).toBe(false)
        expect(memberReadsNotifications.success).toBe(true)
      })
    ))

  it('exposes no team endpoints', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        // Read from `instance`, not the effectful `api`: the latter is a Proxy
        // that answers every property, so it can never disprove one.
        const endpoints = Object.keys(auth.instance.api)

        expect(endpoints).toContain('createOrganization')
        expect(endpoints).not.toContain('createTeam')
        expect(endpoints).not.toContain('setActiveTeam')
      })
    ))
})

describe('two-factor plugin', () => {
  it('enables TOTP, verifies it, and flips twoFactorEnabled on the user', () =>
    run(
      Effect.gen(function* () {
        const { headers, cookiePairs, userId } =
          yield* signUpSession('totp@twofactor.test')
        const auth = yield* Auth.Tag

        // Enabling rotates the session token, so the response's cookies
        // supersede the sign-up ones. The raw instance API (not the effectful
        // proxy) is used because `returnHeaders` is what carries those
        // cookies. The response body is the one-time reveal: the otpauth URI
        // (with its secret) and backup codes.
        const enabled = yield* Effect.promise(() =>
          auth.instance.api.enableTwoFactor({
            body: { password: 'correct-horse-battery-staple' },
            headers,
            returnHeaders: true
          })
        )
        if (enabled.response.method !== 'totp') {
          throw new Error('expected TOTP enable response')
        }
        expect(enabled.response.totpURI).toContain('otpauth://totp/')
        const secret = new URL(enabled.response.totpURI).searchParams.get('secret')
        expect(secret).not.toBeNull()
        expect(enabled.response.backupCodes.length).toBeGreaterThan(0)

        // Merge the sign-up cookies with any cookies the enable response set.
        // With verification required, enable no longer rotates the session —
        // it only stores an unverified secret, and the FIRST verified code
        // (below) flips `twoFactorEnabled` and rotates the session.
        const freshCookies = new Map(
          [
            ...cookiePairs,
            ...enabled.headers.getSetCookie().map((cookie) => cookie.split(';')[0]!)
          ].map((pair) => [pair.split('=')[0]!, pair])
        )
        const cookieHeader = [...freshCookies.values()].join('; ')

        // Server-side helper endpoint: turns a secret into a valid code, so
        // the test plays its own authenticator.
        const { code } = yield* auth.api.generateTOTP({
          body: { secret: decodeUriSecret(secret!) }
        })

        yield* auth.api.verifyTOTP({
          body: { code },
          headers: new Headers({ cookie: cookieHeader })
        })

        const rows = yield* Effect.promise(() =>
          db.select().from(user).where(eq(user.id, userId))
        )
        expect(rows[0]?.twoFactorEnabled).toBe(true)
      })
    ))
})

describe('account lifecycle email flows', () => {
  it('sends a verification email on sign-up and verifies through the token hop', () =>
    run(
      Effect.gen(function* () {
        const email = 'newbie@lifecycle.test'
        const auth = yield* Auth.Tag
        const before = sentEmails.length

        const signUp = yield* Effect.promise(() =>
          auth.instance.api.signUpEmail({
            body: {
              name: 'Newbie',
              email,
              password: 'correct-horse-battery-staple',
              callbackURL: 'http://localhost:3071/verify-email'
            }
          })
        )
        expect(signUp.user.emailVerified).toBe(false)

        const sent = sentEmails
          .slice(before)
          .filter((entry) => entry.kind === 'verification')
        expect(sent).toHaveLength(1)
        const url = sent[0]?.url ?? ''
        // The link points at the auth handler's token-exchange route with our
        // landing page as the callback — not straight at the app route.
        expect(url).toContain('http://localhost:3071/api/auth/verify-email?token=')
        expect(url).toContain(encodeURIComponent('http://localhost:3071/verify-email'))

        const response = yield* Effect.promise(() =>
          auth.instance.handler(new Request(url))
        )
        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe(
          'http://localhost:3071/verify-email'
        )
        // autoSignInAfterVerification: the hop sets a session cookie.
        expect(response.headers.get('set-cookie')).toContain('better-auth')

        const rows = yield* Effect.promise(() =>
          db.select().from(user).where(eq(user.email, email))
        )
        expect(rows[0]?.emailVerified).toBe(true)
      })
    ))

  it('rejects a bad verification token by redirecting with an error param', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        const response = yield* Effect.promise(() =>
          auth.instance.handler(
            new Request(
              `http://localhost:3071/api/auth/verify-email?token=not-a-real-token&callbackURL=${encodeURIComponent('http://localhost:3071/verify-email')}`
            )
          )
        )
        expect(response.status).toBe(302)
        const location = response.headers.get('location') ?? ''
        expect(new URL(location).searchParams.get('error')).toBeTruthy()
      })
    ))

  it('round-trips a password reset: request, hop, set, old sessions revoked', () =>
    run(
      Effect.gen(function* () {
        const email = 'resetter@lifecycle.test'
        const auth = yield* Auth.Tag

        // The sign-up auto sign-in creates the session the reset must revoke.
        const { headers } = yield* Effect.promise(() =>
          auth.instance.api.signUpEmail({
            body: {
              name: 'Resetter',
              email,
              password: 'correct-horse-battery-staple'
            },
            returnHeaders: true
          })
        )
        const before = sentEmails.length

        const requested = yield* Effect.promise(() =>
          auth.instance.api.requestPasswordReset({
            body: { email, redirectTo: 'http://localhost:3071/reset-password' }
          })
        )
        expect(requested.status).toBe(true)

        const resetEmail = sentEmails
          .slice(before)
          .find((entry) => entry.kind === 'reset')
        const resetUrl = resetEmail?.url ?? ''
        expect(resetUrl).toContain('http://localhost:3071/api/auth/reset-password/')
        const token = resetUrl.split('/reset-password/')[1]?.split('?')[0] ?? ''
        expect(token).not.toBe('')

        // The token-exchange hop validates the token and forwards it.
        const hop = yield* Effect.promise(() =>
          auth.instance.handler(new Request(resetUrl))
        )
        expect(hop.status).toBe(302)
        const forwarded = new URL(hop.headers.get('location') ?? '')
        expect(forwarded.pathname).toBe('/reset-password')
        expect(forwarded.searchParams.get('token')).toBe(token)

        const reset = yield* Effect.promise(() =>
          auth.instance.api.resetPassword({
            body: { newPassword: 'fresh-horse-battery-staple', token }
          })
        )
        expect(reset.status).toBe(true)

        // The pre-reset session cookie no longer opens a session
        // (revokeSessionsOnPasswordReset). The endpoint's no-session answer
        // is 200 with a `null` body, so the body is the assertion.
        const stale = yield* Effect.promise(() =>
          auth.instance.handler(
            new Request('http://localhost:3071/api/auth/get-session', {
              headers: { cookie: headers.get('set-cookie') ?? '' }
            })
          )
        )
        expect(stale.status).toBe(200)
        const staleBody = yield* Effect.promise(() => stale.json())
        expect(staleBody).toBeNull()

        // The old password is gone; the new one signs in.
        const oldAttempt: { readonly ok: boolean; readonly error?: unknown } =
          yield* Effect.promise(() =>
            auth.instance.api
              .signInEmail({
                body: { email, password: 'correct-horse-battery-staple' }
              })
              .then(
                () => ({ ok: true }),
                (error: unknown) => ({ ok: false, error })
              )
          )
        expect(oldAttempt.ok).toBe(false)

        const fresh = yield* Effect.promise(() =>
          auth.instance.api.signInEmail({
            body: { email, password: 'fresh-horse-battery-staple' }
          })
        )
        expect(fresh.user.email).toBe(email)
      })
    ))

  it('answers unknown-email reset requests identically and sends nothing', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        const before = sentEmails.length

        const requested = yield* Effect.promise(() =>
          auth.instance.api.requestPasswordReset({
            body: {
              email: 'ghost@lifecycle.test',
              redirectTo: 'http://localhost:3071/reset-password'
            }
          })
        )
        expect(requested.status).toBe(true)
        expect(requested.message).toContain('If this email exists')
        expect(sentEmails.slice(before)).toHaveLength(0)
      })
    ))
})

/**
 * The MCP OAuth authorization server (ADR 0055), driven the way an MCP client
 * drives it: discovery, then the authorization code flow with PKCE, with the
 * starter's two hops in the middle — the consent page picks a workspace and
 * vouches for the pick on `oauth2/continue`, then accepts on `oauth2/consent`.
 * The access token that comes out must verify against `/api/auth/jwks` and
 * carry the workspace claims the API worker maps onto its `WorkspaceContext`.
 */
describe('mcp oauth authorization server', () => {
  const CLIENT_ID = 'https://mcp-client.live.test/oauth/client-metadata.json'
  const REDIRECT_URI = 'http://127.0.0.1:33418/oauth/callback'

  /**
   * The provider's re-entry endpoints (`oauth2/continue`, `oauth2/consent`)
   * answered through the instance handler — the same Request shape the web
   * app's consent page forwards — resolved to wherever the provider points
   * next, whether that arrives as a 302 or a JSON `{ url }` body.
   */
  function postForRedirect(
    auth: {
      readonly instance: { readonly handler: (request: Request) => Promise<Response> }
    },
    path: string,
    headers: Headers,
    body: Record<string, unknown>
  ) {
    const requestHeaders = new Headers(headers)
    requestHeaders.set('content-type', 'application/json')
    return Effect.flatMap(
      Effect.promise(() =>
        auth.instance.handler(
          new Request(`http://localhost:3071/api/auth${path}`, {
            method: 'POST',
            headers: requestHeaders,
            // oxlint-disable-next-line effect/noGlobals -- the auth handler's own JSON wire format is the thing under test here
            body: JSON.stringify(body)
          })
        )
      ),
      redirectTarget
    )
  }

  /**
   * RFC 7636: the verifier stays with the client, the S256 challenge goes in
   * the request. The challenge is `BASE64URL(SHA256(verifier))` — a fixed
   * pair, so the test carries no hashing code; recompute it if you change the
   * verifier.
   */
  function pkce() {
    const verifier = 'live-test-verifier-0123456789abcdefghijklmnopqrstuvwxyz'
    const challenge = 'UZniAYhXZU8-4e7438nGpsqTBRg7vbGm2_jWHK56vvQ'
    return { verifier, challenge }
  }

  const RedirectBody = Schema.Struct({ url: Schema.String })
  const decodeRedirectBody = Schema.decodeUnknownSync(RedirectBody)

  /** The location a redirecting endpoint answered with, whether as a 302 or a JSON `{ url }`. */
  function redirectTarget(response: Response) {
    return Effect.gen(function* () {
      const location = response.headers.get('location')
      if (location !== null) {
        return new URL(location, 'http://localhost:3071')
      }
      const body = decodeRedirectBody(yield* Effect.promise(() => response.json()))
      return new URL(body.url, 'http://localhost:3071')
    })
  }

  it('serves discovery: the JWKS and the RFC 8414 metadata at the issuer-inserted path', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        const jwks = yield* Effect.promise(() =>
          auth.instance.handler(new Request('http://localhost:3071/api/auth/jwks'))
        )
        expect(jwks.status).toBe(200)
        const keys = yield* Effect.promise(() => jwks.json())
        expect(Array.isArray(keys.keys) && keys.keys.length > 0).toBe(true)

        // The request arrives at the origin root, outside `/api/auth/*` — the
        // web app forwards it (`routes/[.]well-known.oauth-authorization-server.$.ts`).
        const metadata = yield* Effect.promise(() =>
          auth.instance.handler(
            new Request(
              'http://localhost:3071/.well-known/oauth-authorization-server/api/auth'
            )
          )
        )
        expect(metadata.status).toBe(200)
        const document = yield* Effect.promise(() => metadata.json())
        expect(document.issuer).toBe('http://localhost:3071/api/auth')
        expect(document.authorization_endpoint).toBe(
          'http://localhost:3071/api/auth/oauth2/authorize'
        )
        expect(document.jwks_uri).toBe('http://localhost:3071/api/auth/jwks')
        expect(document.code_challenge_methods_supported).toContain('S256')
        expect(document.client_id_metadata_document_supported).toBe(true)
      })
    ))

  it('issues a workspace-bound access token after the consent page picks a workspace', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        const { headers, userId } = yield* signUpSession('member@mcp.test')
        const workspace = yield* auth.api.createOrganization({
          body: { name: 'MCP Co', slug: 'mcp-co' },
          headers
        })
        // A CIMD client, as the plugin would have registered it on discovery:
        // registration links the client to the MCP resource it asked for.
        yield* Effect.promise(() =>
          db
            .insert(oauthClient)
            .values({
              id: 'oac_live_mcp',
              clientId: CLIENT_ID,
              name: 'Live MCP client',
              redirectUris: [REDIRECT_URI],
              tokenEndpointAuthMethod: 'none',
              grantTypes: ['authorization_code', 'refresh_token'],
              responseTypes: ['code'],
              scopes: ['openid', 'offline_access', 'mcp:read'],
              requirePKCE: true
            })
            .run()
        )
        yield* Effect.promise(() =>
          db
            .insert(oauthClientResource)
            .values({
              id: 'ocr_live_mcp',
              clientId: CLIENT_ID,
              resourceId: 'http://localhost:8787/mcp'
            })
            .run()
        )
        const { verifier, challenge } = pkce()

        // 1. The client sends the browser to /oauth2/authorize. Signed in, with
        //    no workspace vouched for, the provider's post-login hop sends it to
        //    the consent page carrying the signed request.
        const authorize = new URL('http://localhost:3071/api/auth/oauth2/authorize')
        authorize.searchParams.set('client_id', CLIENT_ID)
        authorize.searchParams.set('redirect_uri', REDIRECT_URI)
        authorize.searchParams.set('response_type', 'code')
        authorize.searchParams.set('scope', 'openid offline_access mcp:read')
        authorize.searchParams.set('state', 'xyz')
        authorize.searchParams.set('code_challenge', challenge)
        authorize.searchParams.set('code_challenge_method', 'S256')
        authorize.searchParams.set('resource', 'http://localhost:8787/mcp')
        const toConsent = yield* redirectTarget(
          yield* Effect.promise(() =>
            auth.instance.handler(new Request(authorize, { headers }))
          )
        )
        expect(toConsent.pathname).toBe(MCP_CONSENT_PAGE)
        expect(toConsent.searchParams.get('client_id')).toBe(CLIENT_ID)
        expect(toConsent.searchParams.has('sig')).toBe(true)

        // 2. The consent server function: pick the workspace, then resume the
        //    authorization vouching for the pick.
        yield* auth.api.setActiveOrganization({
          body: { organizationId: workspace.id },
          headers
        })
        const vouching = new Headers(headers)
        vouching.set(MCP_WORKSPACE_SELECTED_HEADER, workspace.id)
        const continued = yield* postForRedirect(auth, '/oauth2/continue', vouching, {
          postLogin: true,
          oauth_query: toConsent.search.slice(1)
        })
        // No standing consent yet: back to the consent page, this time as the
        // consent hop (the provider marks the pick as cleared for this session).
        expect(continued.pathname).toBe(MCP_CONSENT_PAGE)
        expect(continued.searchParams.has('ba_pl')).toBe(true)

        // 3. Accept — the code is issued to the client's redirect URI.
        const callback = yield* postForRedirect(auth, '/oauth2/consent', headers, {
          accept: true,
          oauth_query: continued.search.slice(1)
        })
        expect(callback.origin + callback.pathname).toBe(REDIRECT_URI)
        expect(callback.searchParams.get('state')).toBe('xyz')
        const code = callback.searchParams.get('code')
        expect(code).not.toBeNull()

        // 4. The client exchanges the code.
        const tokenResponse = yield* Effect.promise(() =>
          auth.instance.handler(
            new Request('http://localhost:3071/api/auth/oauth2/token', {
              method: 'POST',
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code ?? '',
                redirect_uri: REDIRECT_URI,
                client_id: CLIENT_ID,
                code_verifier: verifier,
                resource: 'http://localhost:8787/mcp'
              })
            })
          )
        )
        expect(tokenResponse.status).toBe(200)
        const TokenPair = Schema.Struct({
          access_token: Schema.String,
          refresh_token: Schema.String
        })
        const decodeTokenPair = Schema.decodeUnknownSync(TokenPair)
        const tokens = decodeTokenPair(
          yield* Effect.promise(() => tokenResponse.json())
        )
        expect(tokens.access_token.length).toBeGreaterThan(0)
        expect(tokens.refresh_token.length).toBeGreaterThan(0)

        // 5. The access token verifies against the published JWKS and names
        //    the picked workspace — the claims the API worker acts on.
        const jwksResponse = yield* Effect.promise(() =>
          auth.instance.handler(new Request('http://localhost:3071/api/auth/jwks'))
        )
        const keySet = createLocalJWKSet(
          yield* Effect.promise(() => jwksResponse.json())
        )
        const { payload } = yield* Effect.promise(() =>
          jwtVerify(tokens.access_token, keySet, {
            issuer: 'http://localhost:3071/api/auth',
            audience: 'http://localhost:8787/mcp'
          })
        )
        expect(payload.sub).toBe(userId)
        expect(payload.scope).toBe('openid offline_access mcp:read')
        expect(payload[MCP_WORKSPACE_ID_CLAIM]).toBe(workspace.id)
        expect(payload[MCP_WORKSPACE_SLUG_CLAIM]).toBe('mcp-co')
        expect(payload[MCP_WORKSPACE_ROLE_CLAIM]).toBe('owner')

        // The consent row carries the workspace as its reference, so a consent
        // for this workspace is no consent for another.
        const consents = yield* auth.api.getOAuthConsents({ headers })
        expect(consents.map((consent) => consent.referenceId)).toEqual([workspace.id])
      })
    ))

  it('refuses to authorize without a workspace pick', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        const { headers } = yield* signUpSession('nopick@mcp.test')
        yield* Effect.promise(() =>
          db
            .insert(oauthClient)
            .values({
              id: 'oac_live_nopick',
              clientId: 'https://nopick.live.test/client.json',
              redirectUris: [REDIRECT_URI],
              tokenEndpointAuthMethod: 'none',
              scopes: ['openid', 'mcp:read']
            })
            .run()
        )
        const { challenge } = pkce()
        const authorize = new URL('http://localhost:3071/api/auth/oauth2/authorize')
        authorize.searchParams.set('client_id', 'https://nopick.live.test/client.json')
        authorize.searchParams.set('redirect_uri', REDIRECT_URI)
        authorize.searchParams.set('response_type', 'code')
        authorize.searchParams.set('scope', 'openid mcp:read')
        authorize.searchParams.set('code_challenge', challenge)
        authorize.searchParams.set('code_challenge_method', 'S256')
        const toConsent = yield* redirectTarget(
          yield* Effect.promise(() =>
            auth.instance.handler(new Request(authorize, { headers }))
          )
        )
        // Vouching for a workspace that is not on the session is not a pick:
        // the provider sends the browser back to the consent page.
        const vouching = new Headers(headers)
        vouching.set(MCP_WORKSPACE_SELECTED_HEADER, 'wrk_never_picked')
        const continued = yield* postForRedirect(auth, '/oauth2/continue', vouching, {
          postLogin: true,
          oauth_query: toConsent.search.slice(1)
        })
        expect(continued.pathname).toBe(MCP_CONSENT_PAGE)
        expect(continued.searchParams.has('ba_pl')).toBe(false)
      })
    ))
})
describe('email-otp plugin', () => {
  /** The code the send endpoint generated for one email, most recent first. */
  function codeFor(email: string): string {
    const sent = sentCodes.toReversed().find((entry) => entry.email === email)
    if (sent === undefined) {
      throw new Error(`no one-time code was sent to ${email}`)
    }
    return sent.otp
  }

  /**
   * Plays a verify round, collapsing the thrown APIError to its numeric
   * status. This better-call version carries the code on `statusCode` (its
   * `status` holds the status NAME). Non-async on purpose: the Effect lint
   * rules ban `async` helpers, and a `.then` chain reads the same.
   */
  /**
   * Plays a verify round, collapsing the thrown APIError to its numeric
   * status. This better-call version carries the code on `statusCode` (its
   * `status` holds the status NAME). Non-async on purpose: the Effect lint
   * rules ban `async` helpers, and a `.then` chain reads the same. Nothing
   * reads the fulfilled value, so the generic is never bound at a call site.
   */
  function attempt<T>(
    call: () => Promise<T>
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly status: number }> {
    return call().then(
      () => ({ ok: true }),
      (error: unknown) => {
        // SAFETY: better-call's APIError declares `statusCode: number` on
        // every rejection; the assertion only re-states that shape at this
        // catch boundary.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion, effect/noAs -- re-typing the rejected error better-call throws
        return { ok: false, status: (error as { statusCode?: number }).statusCode ?? 0 }
      }
    )
  }

  it('sends a six-digit sign-in code and signs the holder in', () =>
    run(
      Effect.gen(function* () {
        const email = 'coder@otp.test'
        yield* signUpSession(email)
        const auth = yield* Auth.Tag
        const before = sentCodes.length

        const sent = yield* auth.api.sendVerificationOTP({
          body: { email, type: 'sign-in' }
        })
        expect(sent.success).toBe(true)

        const code = codeFor(email)
        expect(code).toMatch(/^\d{6}$/)
        expect(sentCodes.slice(before)[0]?.type).toBe('sign-in')

        const { headers, response } = yield* Effect.promise(() =>
          auth.instance.api.signInEmailOTP({
            body: { email, otp: code },
            returnHeaders: true
          })
        )
        expect(response.user.email).toBe(email)
        expect(headers.getSetCookie().join(' ')).toContain('better-auth')
      })
    ))

  it('locks the code after three failed attempts, even for the correct one', () =>
    run(
      Effect.gen(function* () {
        const email = 'lockout@otp.test'
        yield* signUpSession(email)
        const auth = yield* Auth.Tag

        yield* auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })
        const code = codeFor(email)

        // Three wrong attempts are each answered INVALID_OTP (400). The wrong
        // code is defined against the real one, so the test cannot flake into
        // a correct guess.
        let wrongCode = '000000'
        if (code === '000000') {
          wrongCode = '000001'
        }
        for (let attemptNo = 0; attemptNo < 3; attemptNo += 1) {
          const wrong = yield* Effect.promise(() =>
            attempt(() =>
              auth.instance.api.signInEmailOTP({
                body: { email, otp: wrongCode }
              })
            )
          )
          expect(wrong).toEqual({ ok: false, status: 400 })
        }

        // The fourth attempt carries the correct code and still dies —
        // TOO_MANY_ATTEMPTS (403), the plugin's lockout.
        const locked = yield* Effect.promise(() =>
          attempt(() =>
            auth.instance.api.signInEmailOTP({ body: { email, otp: code } })
          )
        )
        expect(locked).toEqual({ ok: false, status: 403 })

        // And the lockout consumed the code: the row is gone, so even the
        // correct code now reads as invalid. A fresh send is the only way in.
        const consumed = yield* Effect.promise(() =>
          attempt(() =>
            auth.instance.api.signInEmailOTP({ body: { email, otp: code } })
          )
        )
        expect(consumed).toEqual({ ok: false, status: 400 })
      })
    ))

  it('answers an unknown email identically and sends nothing', () =>
    run(
      Effect.gen(function* () {
        const email = 'ghost@otp.test'
        const auth = yield* Auth.Tag
        const before = sentCodes.length

        const sent = yield* auth.api.sendVerificationOTP({
          body: { email, type: 'sign-in' }
        })
        expect(sent.success).toBe(true)
        expect(sentCodes.slice(before)).toHaveLength(0)

        // With disableSignUp the unsent code verifies to nothing.
        const verify = yield* Effect.promise(() =>
          attempt(() =>
            auth.instance.api.signInEmailOTP({ body: { email, otp: '123456' } })
          )
        )
        expect(verify).toEqual({ ok: false, status: 400 })
      })
    ))

  it('verifies an email address with a code and opens a session', () =>
    run(
      Effect.gen(function* () {
        const email = 'verify-by-code@otp.test'
        const { userId } = yield* signUpSession(email)
        const auth = yield* Auth.Tag

        yield* auth.api.sendVerificationOTP({
          body: { email, type: 'email-verification' }
        })

        // The unverified state the link flow would clear:
        const unverified = yield* Effect.promise(() =>
          db.select().from(user).where(eq(user.id, userId))
        )
        expect(unverified[0]?.emailVerified).toBe(false)

        const verified = yield* auth.api.verifyEmailOTP({
          body: { email, otp: codeFor(email) }
        })
        expect(verified.status).toBe(true)
        // autoSignInAfterVerification carries over: the response names a session.
        expect(verified.token).not.toBeNull()

        const rows = yield* Effect.promise(() =>
          db.select().from(user).where(eq(user.id, userId))
        )
        expect(rows[0]?.emailVerified).toBe(true)
      })
    ))

  it('resets a password with a code and revokes the prior sessions', () =>
    run(
      Effect.gen(function* () {
        const email = 'otp-reset@otp.test'
        const { headers } = yield* signUpSession(email)
        const auth = yield* Auth.Tag

        const requested = yield* auth.api.requestPasswordResetEmailOTP({
          body: { email }
        })
        expect(requested.success).toBe(true)

        const reset = yield* auth.api.resetPasswordEmailOTP({
          body: {
            email,
            otp: codeFor(email),
            password: 'fresh-otp-password-1'
          }
        })
        expect(reset.success).toBe(true)

        // Same contract as the link reset: the pre-reset session is gone.
        const stale = yield* Effect.promise(() =>
          auth.instance.handler(
            new Request('http://localhost:3071/api/auth/get-session', {
              headers: { cookie: headers.get('cookie') ?? '' }
            })
          )
        )
        const staleBody = yield* Effect.promise(() => stale.json())
        expect(staleBody).toBeNull()

        const fresh = yield* Effect.promise(() =>
          auth.instance.api.signInEmail({
            body: { email, password: 'fresh-otp-password-1' }
          })
        )
        expect(fresh.user.email).toBe(email)
      })
    ))
})

describe('magic-link sign-in', () => {
  // The app's adapter sends these three callbacks with every request; the
  // tests mirror them so the hop's redirects are the ones users see.
  const callbacks = {
    callbackURL: 'http://localhost:3071/magic-link/verify',
    newUserCallbackURL: 'http://localhost:3071/magic-link/verify',
    errorCallbackURL: 'http://localhost:3071/magic-link/verify'
  }

  it('round-trips a link for an existing user: request, hop, session', () =>
    run(
      Effect.gen(function* () {
        const email = 'linker@magic.test'
        const auth = yield* Auth.Tag
        yield* signUpSession(email)
        const before = sentEmails.length

        const requested = yield* auth.api.signInMagicLink({
          body: { email, ...callbacks },
          // The endpoint is `requireHeaders: true` (it carries the CSRF
          // middleware); a bare header set satisfies the requirement here.
          headers: new Headers()
        })
        expect(requested.status).toBe(true)

        const sent = sentEmails
          .slice(before)
          .filter((entry) => entry.kind === 'magic-link')
        expect(sent).toHaveLength(1)
        const url = sent[0]?.url ?? ''
        expect(url).toContain('http://localhost:3071/api/auth/magic-link/verify?token=')

        const response = yield* Effect.promise(() =>
          auth.instance.handler(new Request(url))
        )
        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe(
          'http://localhost:3071/magic-link/verify'
        )
        // The hop opens the session itself — the arrival at the landing page
        // is already signed in.
        expect(response.headers.get('set-cookie')).toContain('better-auth')
      })
    ))

  it('stores the token hashed, not as the emailed plaintext', () =>
    run(
      Effect.gen(function* () {
        const email = 'hashed@magic.test'
        const auth = yield* Auth.Tag
        const before = sentEmails.length

        yield* auth.api.signInMagicLink({
          body: { email, ...callbacks },
          headers: new Headers()
        })

        const url = sentEmails
          .slice(before)
          .find((entry) => entry.kind === 'magic-link')?.url
        const token = new URL(url ?? '').searchParams.get('token') ?? ''
        expect(token).not.toBe('')
        // A read of the `verification` table must not be enough to mint a
        // session: the identifier is the hash, never the emailed token.
        const rows = yield* Effect.promise(() => db.select().from(verification))
        expect(rows.some((row) => row.identifier === token)).toBe(false)
      })
    ))

  it('creates a verified user when an unknown email consumes a link', () =>
    run(
      Effect.gen(function* () {
        const email = 'newcomer@magic.test'
        const auth = yield* Auth.Tag
        const before = sentEmails.length

        yield* auth.api.signInMagicLink({
          body: { email, ...callbacks },
          headers: new Headers()
        })
        const url = sentEmails
          .slice(before)
          .find((entry) => entry.kind === 'magic-link')?.url

        const response = yield* Effect.promise(() =>
          auth.instance.handler(new Request(url ?? ''))
        )
        // A brand-new account lands on the new-user callback, signed in —
        // consuming the link is the mailbox proof, so `requireEmailVerification`
        // has nothing left to gate.
        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe(
          'http://localhost:3071/magic-link/verify'
        )
        expect(response.headers.get('set-cookie')).toContain('better-auth')

        const rows = yield* Effect.promise(() =>
          db.select().from(user).where(eq(user.email, email))
        )
        expect(rows).toHaveLength(1)
        expect(rows[0]?.emailVerified).toBe(true)
      })
    ))
})
