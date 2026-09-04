import {
  auditEvents,
  user,
  webhookEndpoints,
  workspaceInvitations,
  workspaceMembers,
  workspaces
} from '@b2b-saas-starter/db/schema'
import {
  Database,
  layerFromD1,
  type EffectDatabase,
  type RawD1
} from '@b2b-saas-starter/db/service'
import { provisionTestD1 } from '@b2b-saas-starter/db/testing'
import { Context, Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'

import { auditEventContractDataset } from '../governance/audit-event-log.contract.ts'
import { type PlatformUserAdminBinding } from '../governance/platform-user-admin.ts'
import {
  CONTRACT_EXPIRED_AT,
  CONTRACT_UNEXPIRED_AT
} from '../governance/workspace-invitations.contract.ts'
import { type WorkspaceInvitationBinding } from '../governance/workspace-invitations.ts'
import { type WorkspaceLifecycleBinding } from '../governance/workspace-lifecycle.ts'
import { type WorkspaceMemberBinding } from '../governance/workspace-membership.ts'
import { type LiveWorkspaceExportsOptions } from '../governance/workspace-export.live.ts'
import { makeLiveCapabilitiesLayer, type CapabilityServices } from '../layers.ts'
import { type StarterEnv } from '../runtime.ts'
import { liveWorkspaceContext, type WorkspaceContext } from '../workspace-context.ts'
import { type CapabilityUnavailable, type WorkspaceNotFound } from '../errors.ts'

/**
 * The shared fixture for the `*.live.test.ts` suites: one provisioned local D1
 * with every migration applied, the rows every live suite reads, and the fake
 * plugin bindings those suites drive the Live adapters with.
 *
 * Each test file builds its own `TestDatabase` (vitest isolates modules per
 * file), so the fixture rows below are inserted once per file and no suite can
 * observe another file's writes. What must not be duplicated is this setup
 * itself — a live suite imports it, it does not restate it.
 */

const iso = '2026-07-03T09:00:00.000Z'

/** Workspaces, members, and fixtures every live suite reads. */
const insertFixtureRows = Effect.gen(function* () {
  const db = yield* Database
  yield* db.insert(user).values([
    { id: 'usr_owner', email: 'owner@live.test', name: 'Owner One' },
    { id: 'usr_outsider', email: 'outsider@live.test', name: 'Outsider' },
    // Exists as a user but holds no membership — the membership-mutation suite
    // adds and removes them.
    { id: 'usr_joiner', email: 'joiner@live.test', name: 'Joiner' },
    { id: 'usr_mover', email: 'mover@live.test', name: 'Mover' },
    { id: 'usr_audited', email: 'audited@live.test', name: 'Audited' },
    // The invitation contract invites this address and then accepts as this
    // user — a real row, because accepting joins `workspace_members` to `user`.
    {
      id: 'usr_accepter',
      email: 'accepter@live-invite.test',
      name: 'Accepter'
    },
    // Actors on the audit read-contract dataset rows (FK to `user`).
    { id: 'usr_alice', email: 'alice@live.test', name: 'Alice' },
    { id: 'usr_bob', email: 'bob@live.test', name: 'Bob' },
    // The System Admin the user-admin impersonation cases act as, and the
    // admin target they must refuse.
    {
      id: 'usr_sysadmin',
      email: 'sysadmin@live.test',
      name: 'Sys Admin',
      role: 'admin'
    }
  ])
  // `workspaces` and `workspace_members` are owned by the organization plugin:
  // their timestamps default to epoch integers, and a member row carries a
  // surrogate id rather than a composite key.
  yield* db.insert(workspaces).values([
    { id: 'wrk_live', slug: 'live-lab', name: 'Live Lab' },
    { id: 'wrk_other', slug: 'other-lab', name: 'Other Lab' },
    // Home of the audit read-contract dataset and the full-page pagination
    // suite — isolated so their rows never leak into other suites' counts.
    { id: 'wrk_audit', slug: 'audit-lab', name: 'Audit Lab' },
    { id: 'wrk_audit_pages', slug: 'audit-pages-lab', name: 'Audit Pages Lab' },
    // The developer-platform plan-limit contract runs its create loop here:
    // the starter plan caps tokens, so `PlanLimitExceeded` is reachable.
    { id: 'wrk_capped', slug: 'capped-lab', name: 'Capped Lab', planId: 'starter' },
    // Home of the developer-platform mutation contract: an isolated,
    // uncapped workspace so its creates never collide with other suites'
    // fixtures or entitlement ceilings.
    {
      id: 'wrk_dev_contract',
      slug: 'dev-contract-lab',
      name: 'Dev Contract Lab',
      planId: 'team'
    }
  ])
  yield* db.insert(workspaceMembers).values({
    id: 'mem_dev_contract_owner',
    workspaceId: 'wrk_dev_contract',
    userId: 'usr_owner',
    role: 'owner'
  })
  yield* db.insert(workspaceMembers).values({
    id: 'mem_capped_owner',
    workspaceId: 'wrk_capped',
    userId: 'usr_owner',
    role: 'owner'
  })
  yield* db.insert(auditEvents).values(
    auditEventContractDataset('wrk_audit').map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId ?? null,
      actorUserId: row.actorUserId ?? null,
      eventType: row.eventType,
      targetType: row.targetType,
      targetId: row.targetId ?? null,
      metadata: {},
      createdAt: row.createdAt
    }))
  )
  yield* db.insert(workspaceMembers).values({
    id: 'mem_live_owner',
    workspaceId: 'wrk_live',
    userId: 'usr_owner',
    role: 'owner'
  })
  // Home of the platform-user-admin contract: an isolated workspace where
  // `usr_owner` holds a membership the role-change case mutates.
  yield* db.insert(workspaces).values({
    id: 'wrk_user_admin_contract',
    slug: 'user-admin-contract',
    name: 'User Admin Contract'
  })
  yield* db.insert(workspaceMembers).values({
    id: 'mem_uac_owner',
    workspaceId: 'wrk_user_admin_contract',
    userId: 'usr_owner',
    role: 'member'
  })
  // Already past its expiry when the suite starts: the invitation contract
  // needs one, and no case can age an invitation from inside the interface.
  yield* db.insert(workspaceInvitations).values({
    id: 'inv_live_expired',
    workspaceId: 'wrk_live',
    email: 'expired@live-invite.test',
    role: 'member',
    status: 'pending',
    // `workspace_invitations.expiresAt` is `mode: 'timestamp'`, so drizzle wants
    // a `Date`. The value is a fixed literal, not a reading of the clock, so
    // there is nothing here for `Clock` to control.
    // oxlint-disable-next-line effect/noGlobals -- fixed literal date, not a clock read; drizzle's timestamp mode requires a Date instance
    expiresAt: new Date(CONTRACT_EXPIRED_AT),
    inviterId: 'usr_owner'
  })
  // The endpoint the webhook delivery-attempt suite records attempts against.
  yield* db.insert(webhookEndpoints).values({
    id: 'wh_live',
    workspaceId: 'wrk_live',
    url: 'https://example.com/hook',
    signingSecret: 'whsec_live_test',
    enabled: true,
    events: ['webhook_endpoint.created'],
    createdAt: iso
  })
})

/**
 * The raw D1 binding behind `TestDatabase`. Every suite but one is handed a
 * ready-made `Database`; the `StarterEnv` suite is not — it exercises the
 * selection that *builds* that layer, so it needs the binding an app would put
 * on `StarterEnv.DB`.
 */
export class TestD1 extends Context.Service<TestD1, NonNullable<StarterEnv['DB']>>()(
  '@b2b-saas-starter/capabilities/test/TestD1'
) {}

/**
 * The provisioned D1 is a live suite's fixture: acquired once and released when
 * the test layer's scope closes, so no test lifecycle hooks are needed.
 */
export const TestDatabase = Layer.unwrap(
  Effect.gen(function* () {
    const provisioned = yield* Effect.acquireRelease(
      Effect.promise(() => provisionTestD1()),
      (testD1) => Effect.promise(() => testD1.dispose())
    )
    const database = layerFromD1(provisioned.d1)
    yield* insertFixtureRows.pipe(Effect.provide(database))
    return Layer.merge(database, Layer.succeed(TestD1)(provisioned.d1))
  })
)

/** How long a live suite may take, D1 provisioning included. */
export const LIVE_SUITE_TIMEOUT = '120 seconds'

/**
 * Runs an effect against the live capability layers of one workspace. The
 * plugin-backed bindings ride in a bag rather than as trailing positionals:
 * a suite that needs only the invitation one would otherwise pass a hole.
 */
export function inWorkspace<A, E>(
  slug: string,
  effect: Effect.Effect<A, E, WorkspaceContext | CapabilityServices>,
  actor?: { readonly userId: string },
  bindings?: {
    readonly memberBinding?: WorkspaceMemberBinding
    readonly invitationBinding?: WorkspaceInvitationBinding
    readonly lifecycleBinding?: WorkspaceLifecycleBinding
    readonly userAdminBinding?: PlatformUserAdminBinding
    /** Stub export queue + bucket (ADR 0055); absent, exports report unavailable. */
    readonly workspaceExports?: LiveWorkspaceExportsOptions
  }
): Effect.Effect<A, E | WorkspaceNotFound | CapabilityUnavailable, Database | RawD1> {
  return Effect.provide(
    effect,
    Layer.merge(
      makeLiveCapabilitiesLayer({
        memberBinding: bindings?.memberBinding,
        invitationBinding: bindings?.invitationBinding,
        lifecycleBinding: bindings?.lifecycleBinding,
        userAdminBinding: bindings?.userAdminBinding,
        workspaceExports: bindings?.workspaceExports
      }),
      liveWorkspaceContext(slug, actor)
    )
  )
}

/**
 * A stand-in for the organization plugin's member endpoints. The plugin's own
 * behaviour is covered in packages/auth/src/live-auth.test.ts; what the live
 * suites own is the capability's half of the contract — that it calls the
 * binding with the resolved workspace, reads the result back, and audits it.
 */
export function fakeMemberBinding(db: EffectDatabase) {
  const calls: Array<unknown> = []
  const binding: WorkspaceMemberBinding = {
    addMember: (input) => {
      calls.push(input)
      return Effect.runPromise(
        Effect.asVoid(
          db.insert(workspaceMembers).values({
            id: `mem_${input.userId}`,
            workspaceId: input.workspaceId,
            userId: input.userId,
            role: input.role
          })
        )
      )
    },
    removeMember: (input) => {
      calls.push(input)
      return Effect.runPromise(
        Effect.asVoid(
          db.delete(workspaceMembers).where(eq(workspaceMembers.id, input.memberId))
        )
      )
    },
    changeRole: (input) => {
      calls.push(input)
      return Effect.runPromise(
        Effect.asVoid(
          db
            .update(workspaceMembers)
            .set({ role: input.role })
            .where(eq(workspaceMembers.id, input.memberId))
        )
      )
    }
  }
  return { binding, calls }
}

/**
 * A stand-in for the admin plugin's user endpoints, on the same terms as
 * `fakeMemberBinding`: the capability's half of the contract only.
 */
export function fakeUserAdminBinding(db: EffectDatabase): PlatformUserAdminBinding {
  return {
    banUser: (input) =>
      Effect.runPromise(
        Effect.asVoid(
          db.update(user).set({ banned: true }).where(eq(user.id, input.userId))
        )
      ),
    unbanUser: (input) =>
      Effect.runPromise(
        Effect.asVoid(
          db.update(user).set({ banned: false }).where(eq(user.id, input.userId))
        )
      ),
    setMemberRole: (input) =>
      Effect.runPromise(
        Effect.asVoid(
          db
            .update(workspaceMembers)
            .set({ role: input.role })
            .where(eq(workspaceMembers.id, input.memberId))
        )
      ),
    // The plugin's impersonation endpoints only move cookies and a session
    // row; neither is observable through the capability, so the stand-ins
    // resolve and the suite asserts on the audit and notification rows.
    impersonateUser: () => Effect.runPromise(Effect.void),
    stopImpersonating: () => Effect.runPromise(Effect.void)
  }
}

// A stand-in for the organization plugin's invitation endpoints, on the same
// terms as `fakeMemberBinding`: the plugin's own behaviour belongs to
// packages/auth, and what these own is the capability's half — that it calls
// the binding with the resolved workspace, reads the row back, and audits it.
// The plugin mints a fresh id per invitation, and so must this: one address
// may be invited, have it settled, and be invited again. The counter is
// shared across binding instances because the rows they write are — every
// case in one test file writes to that file's single D1.
let mintedInvitations = 0

export function fakeInvitationBinding(db: EffectDatabase) {
  const calls: Array<unknown> = []
  const binding: WorkspaceInvitationBinding = {
    create: (input) => {
      calls.push(input)
      mintedInvitations += 1
      return Effect.runPromise(
        Effect.asVoid(
          db.insert(workspaceInvitations).values({
            id: `inv_live_${mintedInvitations}`,
            workspaceId: input.workspaceId,
            email: input.email,
            role: input.role,
            status: 'pending',
            // A literal well ahead of the suite's TestClock rather than a clock
            // read: the capability reads expiry back off the row, and these
            // invitations are all meant to be acceptable.
            // oxlint-disable-next-line effect/noGlobals -- fixed literal date, not a clock read; drizzle's timestamp mode requires a Date instance
            expiresAt: new Date(CONTRACT_UNEXPIRED_AT),
            inviterId: 'usr_owner'
          })
        )
      )
    },
    cancel: (input) => {
      calls.push(input)
      return Effect.runPromise(
        Effect.asVoid(
          db
            .update(workspaceInvitations)
            .set({ status: 'canceled' })
            .where(eq(workspaceInvitations.id, input.invitationId))
        )
      )
    },
    // The real plugin settles the invitation and creates the member row in
    // one call, so the stand-in must do both or the capability would look
    // like it accepted an invitation that made nobody a member.
    accept: (input) => {
      calls.push(input)
      return Effect.runPromise(
        Effect.gen(function* () {
          const rows = yield* db
            .select()
            .from(workspaceInvitations)
            .where(eq(workspaceInvitations.id, input.invitationId))
            .limit(1)
          const invitation = rows[0]
          if (!invitation) {
            return
          }
          yield* db
            .update(workspaceInvitations)
            .set({ status: 'accepted' })
            .where(eq(workspaceInvitations.id, input.invitationId))
          yield* db.insert(workspaceMembers).values({
            id: `mem_${invitation.id}`,
            workspaceId: invitation.workspaceId,
            userId: 'usr_accepter',
            role: invitation.role ?? 'member'
          })
        })
      )
    }
  }
  return { binding, calls }
}

/**
 * A stand-in for the organization plugin's lifecycle endpoints, on the same
 * terms as `fakeMemberBinding`. Create also inserts the owner member row,
 * because the real plugin does — and the delete test needs a member to
 * resolve a live `WorkspaceContext` for the created workspace.
 */
let mintedWorkspaces = 0

export function fakeLifecycleBinding(db: EffectDatabase) {
  const calls: Array<unknown> = []
  const binding: WorkspaceLifecycleBinding = {
    create: (input) => {
      calls.push(input)
      // The real plugin refuses a taken slug with a 4xx before it writes;
      // the fake must too, or the unique index would throw and the
      // capability would misread the refusal as the store failing.
      return Effect.runPromise(
        Effect.gen(function* () {
          const existing = yield* db
            .select()
            .from(workspaces)
            .where(eq(workspaces.slug, input.slug))
            .limit(1)
          if (existing.length > 0) {
            // The port is promise-shaped and its rejections are what
            // `callBinding` classifies, so the stand-in has to reject the way
            // the plugin does: by throwing an `Error` carrying a status.
            // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- mimics the plugin's own APIError rejection, which the classifier under test reads
            throw Object.assign(new Error('slug already in use'), {
              statusCode: 409
            })
          }
          mintedWorkspaces += 1
          const id = `wrk_lc_${mintedWorkspaces}`
          yield* db.insert(workspaces).values({
            id,
            slug: input.slug,
            name: input.name
          })
          yield* db.insert(workspaceMembers).values({
            id: `mem_lc_${mintedWorkspaces}`,
            workspaceId: id,
            userId: input.userId,
            role: 'owner'
          })
        })
      )
    },
    rename: (input) => {
      calls.push(input)
      return Effect.runPromise(
        Effect.asVoid(
          db
            .update(workspaces)
            .set({ name: input.name })
            .where(eq(workspaces.id, input.workspaceId))
        )
      )
    },
    remove: (input) => {
      calls.push(input)
      return Effect.runPromise(
        Effect.asVoid(db.delete(workspaces).where(eq(workspaces.id, input.workspaceId)))
      )
    }
  }
  return { binding, calls }
}

/**
 * The plugin rejects with its own `APIError`: an `Error` carrying a numeric
 * `statusCode`. Built by hand rather than imported, because `capabilities`
 * never names Better Auth — the port is structural and so is its failure.
 */
export function pluginRejection(statusCode: number, message: string) {
  // oxlint-disable-next-line effect/noNewError -- the plugin's rejection shape, built by hand rather than imported
  return Object.assign(new Error(message), { statusCode })
}
