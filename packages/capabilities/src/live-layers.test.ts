import { Context, Effect, Layer } from 'effect'
import { describe, expect, layer } from '@effect/vitest'
import { count, eq } from 'drizzle-orm'
import {
  auditEvents,
  Database,
  layerFromD1,
  type EffectDatabase,
  user,
  webhookDeliveries,
  webhookEndpoints,
  workspaceInvitations,
  workspaceMembers,
  workspaces
} from '@b2b-saas-starter/db'
import { provisionTestD1 } from '@b2b-saas-starter/db/testing'
import { ApiTokenRegistry } from './developer-platform/api-token-registry.ts'
import {
  WebhookEndpoints,
  type WebhookDeliveryAttemptInput
} from './developer-platform/webhook-endpoints.ts'
import { AuditEventLog } from './governance/audit-event-log.ts'
import {
  WorkspaceMembership,
  type WorkspaceMemberBinding
} from './governance/workspace-membership.ts'
import { workspaceMembershipContractCases } from './governance/workspace-membership.contract.ts'
import {
  WorkspaceInvitations,
  type WorkspaceInvitationBinding
} from './governance/workspace-invitations.ts'
import {
  CONTRACT_EXPIRED_AT,
  CONTRACT_UNEXPIRED_AT,
  workspaceInvitationsContractCases
} from './governance/workspace-invitations.contract.ts'
import { makeLiveCapabilitiesLayer, type CapabilityServices } from './layers.ts'
import {
  selectCapabilitiesLayer,
  selectWorkspaceLayer,
  type StarterEnv
} from './runtime.ts'
import { liveWorkspaceContext, WorkspaceContext } from './workspace-context.ts'
import {
  CapabilityUnavailable,
  MembershipChangeRejected,
  type WorkspaceNotFound
} from './errors.ts'

// Live-layer coverage against a real local D1 (all migrations applied). The
// Seed-layer tests in index.test.ts validate contracts; these validate that
// the D1 adapters — queries, batches, workspace scoping — behave the same.

const iso = '2026-07-03T09:00:00.000Z'

/** Workspaces, members, and fixtures every test in this file reads. */
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
    }
  ])
  // `workspaces` and `workspace_members` are owned by the organization plugin:
  // their timestamps default to epoch integers, and a member row carries a
  // surrogate id rather than a composite key.
  yield* db.insert(workspaces).values([
    { id: 'wrk_live', slug: 'live-lab', name: 'Live Lab' },
    { id: 'wrk_other', slug: 'other-lab', name: 'Other Lab' }
  ])
  yield* db.insert(workspaceMembers).values({
    id: 'mem_live_owner',
    workspaceId: 'wrk_live',
    userId: 'usr_owner',
    role: 'owner'
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
    events: ['demo.event'],
    createdAt: iso
  })
})

/**
 * The provisioned D1 is this file's fixture: acquired once and released when
 * the test layer's scope closes, so no test lifecycle hooks are needed.
 */
/**
 * The raw D1 binding behind `TestDatabase`. Every suite but one is handed a
 * ready-made `Database`; the `StarterEnv` suite is not — it exercises the
 * selection that *builds* that layer, so it needs the binding an app would put
 * on `StarterEnv.DB`.
 */
class TestD1 extends Context.Service<TestD1, NonNullable<StarterEnv['DB']>>()(
  '@b2b-saas-starter/capabilities/test/TestD1'
) {}

const TestDatabase = Layer.unwrap(
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

/**
 * Runs an effect against the live capability layers of one workspace. The
 * plugin-backed bindings ride in a bag rather than as trailing positionals:
 * a suite that needs only the invitation one would otherwise pass a hole.
 */
function inWorkspace<A, E>(
  slug: string,
  effect: Effect.Effect<A, E, WorkspaceContext | CapabilityServices>,
  actor?: { readonly userId: string },
  bindings?: {
    readonly memberBinding?: WorkspaceMemberBinding
    readonly invitationBinding?: WorkspaceInvitationBinding
  }
): Effect.Effect<A, E | WorkspaceNotFound | CapabilityUnavailable, Database> {
  return Effect.provide(
    effect,
    Layer.merge(
      makeLiveCapabilitiesLayer({
        memberBinding: bindings?.memberBinding,
        invitationBinding: bindings?.invitationBinding
      }),
      liveWorkspaceContext(slug, actor)
    )
  )
}

layer(TestDatabase, { timeout: '120 seconds' })('live capability layers', (it) => {
  describe('live workspace context', () => {
    it.effect('resolves the workspace and actor for a member', () =>
      Effect.gen(function* () {
        const ctx = yield* inWorkspace('live-lab', WorkspaceContext, {
          userId: 'usr_owner'
        })
        expect(ctx.workspace.id).toBe('wrk_live')
        expect(ctx.actor?.role).toBe('owner')
      })
    )

    it.effect('fails with WorkspaceNotFound for an unknown slug', () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          inWorkspace('no-such-workspace', WorkspaceContext)
        )
        expect(error._tag).toBe('WorkspaceNotFound')
      })
    )

    it.effect('fails identically for a non-member actor (non-disclosing)', () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          inWorkspace('live-lab', WorkspaceContext, { userId: 'usr_outsider' })
        )
        expect(error._tag).toBe('WorkspaceNotFound')
      })
    )
  })

  describe('live api token lifecycle', () => {
    it.effect('creates, verifies, lists, revokes, and audits a token', () =>
      Effect.gen(function* () {
        const created = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const registry = yield* ApiTokenRegistry
            return yield* registry.create({
              name: 'Live test token',
              scopes: ['read', 'write'],
              actorUserId: 'usr_owner'
            })
          })
        )
        expect(created.token.startsWith('bsk_live_')).toBe(true)
        expect(created.prefix).toBe(created.token.slice(0, 17))

        const verified = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const registry = yield* ApiTokenRegistry
            return yield* registry.verifyBearerToken(created.token)
          })
        )
        expect(verified.workspaceSlug).toBe('live-lab')
        // Verification reports the token's own scopes and stops there. It no
        // longer judges them: `admin` is absent from this list, and saying so
        // is the whole of its answer.
        expect(verified.scopes).toEqual(['read', 'write'])

        const listed = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const registry = yield* ApiTokenRegistry
            return yield* registry.list
          })
        )
        const listedToken = listed.find((token) => token.id === created.id)
        expect(listedToken?.prefix).toBe(created.prefix)
        // The raw token is returned once at creation and never listed.
        const listedValues = listed.flatMap((token) => Object.values(token).flat())
        expect(listedValues).not.toContain(created.token)

        const revoked = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const registry = yield* ApiTokenRegistry
            return yield* registry.revoke({
              tokenId: created.id,
              actorUserId: 'usr_owner'
            })
          })
        )
        expect(revoked).toBe(true)

        const afterRevoke = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const registry = yield* ApiTokenRegistry
            return yield* Effect.flip(registry.verifyBearerToken(created.token))
          })
        )
        expect(afterRevoke.reason).toBe('invalid_token')

        // Both mutations committed their audit rows atomically alongside the write.
        const events = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const audit = yield* AuditEventLog
            return yield* audit.list
          })
        )
        const types = events.map((event) => event.eventType)
        expect(types).toContain('api_token.created')
        expect(types).toContain('api_token.revoked')
        expect(
          events.find((event) => event.eventType === 'api_token.created')?.actor
        ).toBe('Owner One')
      })
    )
  })

  describe('live audit event workspace isolation', () => {
    it.effect("lists only the requesting workspace's events", () =>
      Effect.gen(function* () {
        yield* inWorkspace(
          'other-lab',
          Effect.gen(function* () {
            const audit = yield* AuditEventLog
            yield* audit.record({
              workspaceId: 'wrk_other',
              eventType: 'isolation.check',
              targetType: 'test'
            })
          })
        )
        const liveEvents = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const audit = yield* AuditEventLog
            return yield* audit.list
          })
        )
        expect(liveEvents.some((event) => event.eventType === 'isolation.check')).toBe(
          false
        )
        const otherEvents = yield* inWorkspace(
          'other-lab',
          Effect.gen(function* () {
            const audit = yield* AuditEventLog
            return yield* audit.list
          })
        )
        expect(otherEvents.some((event) => event.eventType === 'isolation.check')).toBe(
          true
        )
      })
    )
  })

  // A stand-in for the organization plugin's member endpoints. The plugin's own
  // behaviour is covered in packages/auth/src/live-auth.test.ts; what these
  // tests own is the capability's half of the contract — that it calls the
  // binding with the resolved workspace, reads the result back, and audits it.
  function fakeMemberBinding(db: EffectDatabase) {
    const calls: unknown[] = []
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

  describe('live workspace membership mutations', () => {
    it.effect('adds a member through the binding and audits it', () =>
      Effect.gen(function* () {
        const db = yield* Database
        const { binding, calls } = fakeMemberBinding(db)
        const added = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const membership = yield* WorkspaceMembership
            return yield* membership.addMember({
              userId: 'usr_audited',
              role: 'member'
            })
          }),
          { userId: 'usr_owner' },
          { memberBinding: binding }
        )

        // The binding is called with the workspace resolved from context, never
        // a slug or a caller-supplied id.
        expect(calls).toEqual([
          { workspaceId: 'wrk_live', userId: 'usr_audited', role: 'member' }
        ])
        // The returned DTO is read back from D1, so it carries the joined user
        // identity rather than echoing the input.
        expect(added.id).toBe('usr_audited')
        expect(added.email).toBe('audited@live.test')
        expect(added.role).toBe('member')

        const events = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const audit = yield* AuditEventLog
            return yield* audit.list
          }),
          { userId: 'usr_owner' }
        )
        expect(events.map((event) => event.eventType)).toContain(
          'workspace_member.added'
        )
      })
    )

    it.effect('changes a role and removes a member, addressing them by row id', () =>
      Effect.gen(function* () {
        const db = yield* Database
        const { binding, calls } = fakeMemberBinding(db)
        function run<A, E>(
          effect: Effect.Effect<A, E, WorkspaceContext | CapabilityServices>
        ) {
          return inWorkspace(
            'live-lab',
            effect,
            { userId: 'usr_owner' },
            {
              memberBinding: binding
            }
          )
        }

        yield* run(
          Effect.gen(function* () {
            const membership = yield* WorkspaceMembership
            return yield* membership.addMember({
              userId: 'usr_mover',
              role: 'member'
            })
          })
        )

        const promoted = yield* run(
          Effect.gen(function* () {
            const membership = yield* WorkspaceMembership
            return yield* membership.changeRole({
              userId: 'usr_mover',
              role: 'admin'
            })
          })
        )
        expect(promoted.role).toBe('admin')

        yield* run(
          Effect.gen(function* () {
            const membership = yield* WorkspaceMembership
            return yield* membership.removeMember({ userId: 'usr_mover' })
          })
        )

        const remaining = yield* run(
          Effect.gen(function* () {
            const membership = yield* WorkspaceMembership
            return yield* membership.listMembers
          })
        )
        expect(remaining.map((member) => member.id)).not.toContain('usr_mover')

        // The plugin addresses members by their surrogate row id, so the
        // capability must resolve the user id to one before calling out.
        expect(calls).toEqual([
          { workspaceId: 'wrk_live', userId: 'usr_mover', role: 'member' },
          { workspaceId: 'wrk_live', memberId: 'mem_usr_mover', role: 'admin' },
          { workspaceId: 'wrk_live', memberId: 'mem_usr_mover' }
        ])

        const events = yield* run(
          Effect.gen(function* () {
            const audit = yield* AuditEventLog
            return yield* audit.list
          })
        )
        const types = events.map((event) => event.eventType)
        expect(types).toContain('workspace_member.role_changed')
        expect(types).toContain('workspace_member.removed')
      })
    )

    it.effect('rejects a mutation naming someone who is not a member', () =>
      Effect.gen(function* () {
        const db = yield* Database
        const { binding, calls } = fakeMemberBinding(db)
        const error = yield* Effect.flip(
          inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const membership = yield* WorkspaceMembership
              return yield* membership.removeMember({ userId: 'usr_outsider' })
            }),
            { userId: 'usr_owner' },
            { memberBinding: binding }
          )
        )
        expect(error).toBeInstanceOf(MembershipChangeRejected)
        // Rejected before the plugin is touched: no row id to address it with.
        expect(calls).toEqual([])
      })
    )

    it.effect('fails as unavailable when no binding is configured', () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const membership = yield* WorkspaceMembership
              return yield* membership.addMember({
                userId: 'usr_joiner',
                role: 'member'
              })
            }),
            { userId: 'usr_owner' }
          )
        )
        expect(error).toBeInstanceOf(CapabilityUnavailable)
        expect(error instanceof CapabilityUnavailable && error.reason).toBe(
          'no_member_binding'
        )
      })
    )
  })

  // The Seed half of this same list runs in index.test.ts.
  describe('live workspace membership contract', () => {
    const cases = workspaceMembershipContractCases(
      { member: 'usr_owner', newcomer: 'usr_joiner', stranger: 'usr_outsider' },
      expect
    )
    for (const contractCase of cases) {
      it.effect(contractCase.name, () =>
        Effect.gen(function* () {
          const db = yield* Database
          const { binding } = fakeMemberBinding(db)
          yield* inWorkspace(
            'live-lab',
            contractCase.assert,
            { userId: 'usr_owner' },
            { memberBinding: binding }
          )
        })
      )
    }
  })

  // A stand-in for the organization plugin's invitation endpoints, on the same
  // terms as `fakeMemberBinding`: the plugin's own behaviour belongs to
  // packages/auth, and what these own is the capability's half — that it calls
  // the binding with the resolved workspace, reads the row back, and audits it.
  // The plugin mints a fresh id per invitation, and so must this: one address
  // may be invited, have it settled, and be invited again. The counter is
  // shared across binding instances because the rows they write are — every
  // case in this file writes to the same D1.
  let mintedInvitations = 0

  function fakeInvitationBinding(db: EffectDatabase) {
    const calls: unknown[] = []
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
            if (!invitation) return
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

  // The Seed half of this same list runs in index.test.ts.
  describe('live workspace invitations contract', () => {
    const cases = workspaceInvitationsContractCases(
      {
        emailFor: (slot) => `${slot}@live-invite.test`,
        accepter: { userId: 'usr_accepter', email: 'accepter@live-invite.test' },
        expired: {
          invitationId: 'inv_live_expired',
          email: 'expired@live-invite.test'
        }
      },
      expect
    )
    for (const contractCase of cases) {
      it.effect(contractCase.name, () =>
        Effect.gen(function* () {
          const db = yield* Database
          // The cases clean up after themselves via `removeMember`, so the
          // member binding is needed alongside the invitation one.
          const { binding: invitationBinding } = fakeInvitationBinding(db)
          const { binding: memberBinding } = fakeMemberBinding(db)
          yield* inWorkspace(
            'live-lab',
            contractCase.assert,
            { userId: 'usr_owner' },
            {
              invitationBinding,
              memberBinding
            }
          )
        })
      )
    }
  })

  describe('live workspace invitation mutations', () => {
    it.effect('creates through the binding, reads it back, and audits it', () =>
      Effect.gen(function* () {
        const db = yield* Database
        const { binding, calls } = fakeInvitationBinding(db)
        const created = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const invitations = yield* WorkspaceInvitations
            return yield* invitations.create({
              email: 'audited@live-invite.test',
              role: 'admin'
            })
          }),
          { userId: 'usr_owner' },
          { invitationBinding: binding }
        )

        // Called with the workspace resolved from context, never a slug.
        expect(calls).toEqual([
          {
            workspaceId: 'wrk_live',
            email: 'audited@live-invite.test',
            role: 'admin'
          }
        ])
        expect(created.role).toBe('admin')
        expect(created.status).toBe('pending')

        const events = yield* inWorkspace(
          'live-lab',
          Effect.flatMap(AuditEventLog, (audit) => audit.list),
          { userId: 'usr_owner' }
        )
        expect(events.map((event) => event.eventType)).toContain(
          'workspace_invitation.sent'
        )
      })
    )

    it.effect('fails as unavailable when no binding is configured', () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const invitations = yield* WorkspaceInvitations
              return yield* invitations.create({
                email: 'unbound@live-invite.test',
                role: 'member'
              })
            }),
            { userId: 'usr_owner' }
          )
        )
        expect(error).toBeInstanceOf(CapabilityUnavailable)
        expect(error instanceof CapabilityUnavailable && error.reason).toBe(
          'no_invitation_binding'
        )
      })
    )
  })

  // Decision 23: a rejected binding call is classified by its HTTP status.
  // Nothing above reaches this code — every rejection those suites produce is
  // raised by the capability itself, before the binding is ever called — so the
  // classifier that separates "the workspace refuses" (409, do not retry) from
  // "the store is unreachable" (503, retry) is exercised only here.
  describe('live binding failure classification', () => {
    /**
     * The plugin rejects with its own `APIError`: an `Error` carrying a numeric
     * `statusCode`. Built by hand rather than imported, because `capabilities`
     * never names Better Auth — the port is structural and so is its failure.
     */
    function pluginRejection(statusCode: number, message: string) {
      return Object.assign(new Error(message), { statusCode })
    }

    /** A member binding whose every endpoint rejects with the same cause. */
    function rejectingMemberBinding(cause: unknown): WorkspaceMemberBinding {
      function reject() {
        return Promise.reject(cause)
      }
      return { addMember: reject, removeMember: reject, changeRole: reject }
    }

    it.effect('reads a 4xx rejection as a refusal the caller must not retry', () =>
      Effect.gen(function* () {
        const error = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const membership = yield* WorkspaceMembership
            return yield* Effect.flip(
              membership.addMember({ userId: 'usr_joiner', role: 'member' })
            )
          }),
          { userId: 'usr_owner' },
          {
            memberBinding: rejectingMemberBinding(
              pluginRejection(403, 'user is already a member')
            )
          }
        )

        expect(error).toBeInstanceOf(MembershipChangeRejected)
        expect(error.reason).toBe('user is already a member')
      })
    )

    it.effect('reads a 5xx rejection as the store failing, not a refusal', () =>
      Effect.gen(function* () {
        const error = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const membership = yield* WorkspaceMembership
            return yield* Effect.flip(
              membership.addMember({ userId: 'usr_joiner', role: 'member' })
            )
          }),
          { userId: 'usr_owner' },
          {
            memberBinding: rejectingMemberBinding(
              pluginRejection(502, 'upstream unavailable')
            )
          }
        )

        // 503, so the caller retries. A 409 here would tell them to give up on
        // a change that would have succeeded a moment later.
        expect(error).toBeInstanceOf(CapabilityUnavailable)
        expect(error instanceof CapabilityUnavailable && error.capability).toBe(
          'workspace-membership'
        )
        expect(error.reason).toBe('upstream unavailable')
      })
    )

    it.effect('reads a rejection carrying no status as the store failing', () =>
      Effect.gen(function* () {
        const error = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const membership = yield* WorkspaceMembership
            return yield* Effect.flip(
              membership.addMember({ userId: 'usr_joiner', role: 'member' })
            )
          }),
          { userId: 'usr_owner' },
          {
            memberBinding: rejectingMemberBinding(new TypeError('fetch failed'))
          }
        )

        // A dropped connection or a thrown TypeError from the adapter itself.
        // Nothing said the workspace refused, so the classifier must not decide
        // it did.
        expect(error).toBeInstanceOf(CapabilityUnavailable)
        expect(error.reason).toBe('fetch failed')
      })
    )

    /** The invitation port's counterpart, rejecting the same way. */
    function rejectingInvitationBinding(cause: unknown): WorkspaceInvitationBinding {
      function reject() {
        return Promise.reject(cause)
      }
      return { create: reject, cancel: reject, accept: reject }
    }

    // `workspace-invitations.ts` carries its own copy of `classifyBindingFailure`
    // — same rule, different capability name — so the invitation port needs its
    // own cases rather than inheriting the ones above.
    it.effect('applies the same rule to a refused invitation', () =>
      Effect.gen(function* () {
        const error = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const invitations = yield* WorkspaceInvitations
            return yield* Effect.flip(
              invitations.create({ email: 'refused@live-invite.test', role: 'member' })
            )
          }),
          { userId: 'usr_owner' },
          {
            invitationBinding: rejectingInvitationBinding(
              pluginRejection(400, 'already invited')
            )
          }
        )

        expect(error).toBeInstanceOf(MembershipChangeRejected)
        expect(error.reason).toBe('already invited')
      })
    )

    it.effect('names its own capability when the invitation store fails', () =>
      Effect.gen(function* () {
        const error = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const invitations = yield* WorkspaceInvitations
            return yield* Effect.flip(
              invitations.create({
                email: 'unreachable@live-invite.test',
                role: 'member'
              })
            )
          }),
          { userId: 'usr_owner' },
          {
            invitationBinding: rejectingInvitationBinding(
              pluginRejection(500, 'invitation store down')
            )
          }
        )

        expect(error).toBeInstanceOf(CapabilityUnavailable)
        expect(error instanceof CapabilityUnavailable && error.capability).toBe(
          'workspace-invitations'
        )
      })
    )
  })

  // Decision 25: an app hands its plugin bindings to these selectors per call,
  // not on a module-level env, because `apps/web/src/lib/capabilities.ts` is
  // bundled for the browser as well as the worker. Every other suite in this
  // file is handed a layer already built — these two exercise the selection an
  // app actually makes, and so are the only cases that prove a binding put on
  // `StarterEnv` reaches the capability at all.
  describe('live layer selection from StarterEnv', () => {
    it.effect('carries the invitation binding into the workspace layer', () =>
      Effect.gen(function* () {
        const db = yield* Database
        const d1 = yield* TestD1
        const { binding, calls } = fakeInvitationBinding(db)

        const created = yield* Effect.provide(
          Effect.flatMap(WorkspaceInvitations, (invitations) =>
            invitations.create({ email: 'selected@live-invite.test', role: 'member' })
          ),
          selectWorkspaceLayer({ DB: d1, invitationBinding: binding }, 'live-lab', {
            userId: 'usr_owner'
          })
        )

        expect(created.email).toBe('selected@live-invite.test')
        // The workspace id comes from the slug the selector resolved, so this
        // also proves the live `WorkspaceContext` was the one selected.
        expect(calls).toEqual([
          {
            workspaceId: 'wrk_live',
            email: 'selected@live-invite.test',
            role: 'member'
          }
        ])
      })
    )

    it.effect('selects the live layer for an identity-keyed read', () =>
      Effect.gen(function* () {
        const d1 = yield* TestD1
        const memberships = yield* Effect.provide(
          Effect.flatMap(WorkspaceMembership, (membership) =>
            membership.listWorkspacesForUser('usr_owner')
          ),
          selectCapabilitiesLayer({ DB: d1 })
        )

        // `live-lab` exists only in D1. Had the selector fallen to the Seed
        // branch this would be empty, because no fixture member is `usr_owner`.
        expect(memberships.map((each) => each.workspace.slug)).toContain('live-lab')
      })
    )
  })

  describe('live workspace membership projection', () => {
    it.effect('lists memberships for a member and nothing for an outsider', () =>
      Effect.gen(function* () {
        const memberships = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const membership = yield* WorkspaceMembership
            return {
              forOwner: yield* membership.listWorkspacesForUser('usr_owner'),
              forOutsider: yield* membership.listWorkspacesForUser('usr_outsider')
            }
          })
        )
        expect(memberships.forOwner.map((entry) => entry.workspace.slug)).toContain(
          'live-lab'
        )
        expect(memberships.forOutsider).toEqual([])
      })
    )
  })

  // Real-D1 coverage for the terminal-outcome audit contract: LiveWebhookEndpoints
  // batches the audit insert with the delivery row, so these assert the actual
  // audit_events rows rather than a stub's recorded inputs.
  describe('live webhook delivery attempts', () => {
    function recordAttempt(input: WebhookDeliveryAttemptInput) {
      return inWorkspace(
        'live-lab',
        Effect.flatMap(WebhookEndpoints, (webhooks) =>
          webhooks.recordDeliveryAttempt(input)
        )
      )
    }

    function auditRowsFor(eventType: string) {
      return Effect.gen(function* () {
        const db = yield* Database
        return yield* db
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.eventType, eventType))
      })
    }

    const auditEventCount = Effect.gen(function* () {
      const db = yield* Database
      const rows = yield* db.select({ total: count() }).from(auditEvents)
      return rows[0]?.total ?? 0
    })

    function deliveryRow(deliveryId: string) {
      return Effect.gen(function* () {
        const db = yield* Database
        return yield* db
          .select()
          .from(webhookDeliveries)
          .where(eq(webhookDeliveries.id, deliveryId))
      })
    }

    it.effect(
      'batches a webhook.delivery_failed audit event with the terminal attempt row',
      () =>
        Effect.gen(function* () {
          yield* recordAttempt({
            id: 'whd_live_perm',
            endpointId: 'wh_live',
            workspaceId: 'wrk_live',
            eventType: 'demo.event',
            status: 'failed_permanent',
            attempts: 1,
            responseStatus: 410,
            nextAttemptAt: null
          })

          const deliveries = yield* deliveryRow('whd_live_perm')
          expect(deliveries).toHaveLength(1)
          expect(deliveries[0]?.status).toBe('failed_permanent')

          const rows = yield* auditRowsFor('webhook.delivery_failed')
          expect(rows).toHaveLength(1)
          expect(rows[0]).toMatchObject({
            workspaceId: 'wrk_live',
            actorUserId: null,
            targetType: 'webhook_endpoint',
            targetId: 'wh_live'
          })
          // The audit metadata points back at the delivery row it committed with.
          expect(rows[0]?.metadata).toMatchObject({
            deliveryId: 'whd_live_perm',
            eventType: 'demo.event',
            responseStatus: 410
          })
        })
    )

    it.effect(
      'batches a webhook.delivery_dead_lettered audit event with the DLQ attempt row',
      () =>
        Effect.gen(function* () {
          yield* recordAttempt({
            endpointId: 'wh_live',
            workspaceId: 'wrk_live',
            eventType: 'demo.event',
            status: 'dead_lettered',
            attempts: 5,
            responseStatus: null,
            nextAttemptAt: null
          })

          const rows = yield* auditRowsFor('webhook.delivery_dead_lettered')
          expect(rows).toHaveLength(1)
          expect(rows[0]).toMatchObject({
            workspaceId: 'wrk_live',
            actorUserId: null,
            targetType: 'webhook_endpoint',
            targetId: 'wh_live'
          })
          expect(rows[0]?.metadata).toMatchObject({ attempts: 5 })
        })
    )

    it.effect('writes a non-terminal delivered row without an audit event', () =>
      Effect.gen(function* () {
        const before = yield* auditEventCount
        yield* recordAttempt({
          id: 'whd_live_ok',
          endpointId: 'wh_live',
          workspaceId: 'wrk_live',
          eventType: 'demo.event',
          status: 'delivered',
          attempts: 1,
          responseStatus: 200,
          nextAttemptAt: null
        })
        const after = yield* auditEventCount
        expect(after).toBe(before)

        const deliveries = yield* deliveryRow('whd_live_ok')
        expect(deliveries[0]?.status).toBe('delivered')
      })
    )
  })
})
