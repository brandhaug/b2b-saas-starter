import { type DrizzleDatabase } from '@b2b-saas-starter/db/client'
import { user, workspaceInvitations, workspaces } from '@b2b-saas-starter/db/schema'
import { Effect, type Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'
import { Auth } from './index.ts'
import {
  buildAuthLayer,
  enableTotp,
  provisionAuthD1,
  signUpSession,
  type AuthService,
  type ProvisionedAuthD1
} from './test-auth-layer.ts'

// The organization plugin is only observable through a real database: its
// `modelName` overrides, its `additionalFields`, and its role table all resolve
// inside Better Auth and reach D1 as SQL. Asserting the options object instead
// would pass even if no endpoint ever found a table, so this suite drives
// `Auth.api` against a local D1 (workerd) with every committed migration
// applied.

let db: DrizzleDatabase
let provisioned: ProvisionedAuthD1
let authLayer: Layer.Layer<AuthService>

// oxlint-disable-next-line effect/noTestLifecycleHooks -- owns the workerd process
beforeAll(
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        provisioned = yield* Effect.promise(() => provisionAuthD1())
        db = provisioned.db
        authLayer = buildAuthLayer(db)
      })
    ),
  60_000
)

// oxlint-disable-next-line effect/noTestLifecycleHooks -- disposes the workerd process
afterAll(() => provisioned.dispose())

function run<A, E>(effect: Effect.Effect<A, E, AuthService>) {
  return Effect.runPromise(Effect.provide(effect, authLayer))
}

/** The plugin needs an existing user to own the workspace it creates. */
function seedUser(id: string, email: string) {
  return Effect.promise(() => db.insert(user).values({ id, email, name: email }).run())
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
        const { cookieHeader, userId } = yield* signUpSession('totp@twofactor.test')

        // The shared ceremony runs the account panel's flow — enable, then the
        // first verified code, which flips `twoFactorEnabled` and rotates the
        // session token (the response body is the one-time reveal).
        const { response } = yield* enableTotp(cookieHeader)
        expect(response.totpURI).toContain('otpauth://totp/')
        expect(response.backupCodes.length).toBeGreaterThan(0)

        const rows = yield* Effect.promise(() =>
          db.select().from(user).where(eq(user.id, userId))
        )
        expect(rows[0]?.twoFactorEnabled).toBe(true)
      })
    ))
})
