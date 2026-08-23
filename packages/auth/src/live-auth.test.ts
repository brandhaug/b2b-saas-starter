import { createDb, type Database } from '@b2b-saas-starter/db/client'
import { user, workspaceInvitations, workspaces } from '@b2b-saas-starter/db/schema'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { type Service } from 'effectful-better-auth'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Auth, AuthConfig, type AuthEmailSender, type AuthOptions } from './index.ts'

// The organization plugin is only observable through a real database: its
// `modelName` overrides, its `additionalFields`, and its role table all resolve
// inside Better Auth and reach D1 as SQL. Asserting the options object instead
// would pass even if no endpoint ever found a table, so this suite drives
// `Auth.api` against a local D1 (workerd) with every committed migration
// applied.

type AuthService = Service<AuthOptions>

let testD1: TestD1
let db: Database
let authLayer: Layer.Layer<AuthService>

// The lifecycle-email port, capturing what Better Auth hands it instead of
// sending: these tests assert on the URLs and the calls, not on delivery.
const sentEmails: {
  readonly kind: 'reset' | 'verification'
  readonly email: string
  readonly url: string
}[] = []

const capturingEmailSender: AuthEmailSender = {
  sendPasswordReset: ({ email, url }) => {
    sentEmails.push({ kind: 'reset', email, url })
    return Promise.resolve()
  },
  sendEmailVerification: ({ email, url }) => {
    sentEmails.push({ kind: 'verification', email, url })
    return Promise.resolve()
  }
}

// oxlint-disable-next-line effect/noTestLifecycleHooks -- owns the workerd process
beforeAll(
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        testD1 = yield* Effect.promise(() => provisionTestD1())
        db = createDb(testD1.d1)
        authLayer = Auth.layer.pipe(
          Layer.provide(
            Layer.sync(AuthConfig)(() => ({
              db,
              secret: 'test-secret-at-least-32-characters-long',
              baseURL: 'http://localhost:3071',
              trustedOrigins: [],
              emails: capturingEmailSender
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
    const cookie = headers.get('set-cookie')
    if (cookie === null) return yield* Effect.die(`sign-up set no cookie for ${email}`)
    return { headers: new Headers({ cookie }), userId: response.user.id }
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
