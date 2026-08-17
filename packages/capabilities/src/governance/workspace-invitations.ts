import { Context, DateTime, Effect, Layer, Option, Ref, Schema } from 'effect'
import { and, eq } from 'drizzle-orm'
import {
  Database,
  invitationStatuses,
  workspaceInvitations,
  workspaces,
  type EffectDatabase
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable, MembershipChangeRejected } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { readPluginBindingFailure } from './plugin-binding-failure.ts'
import { WorkspaceRole, type Member, type Workspace } from './workspace-identity.ts'
import { type SeedRoster } from './workspace-membership.ts'

export const InvitationStatus = Schema.Literals(invitationStatuses)
export type InvitationStatus = typeof InvitationStatus.Type

/**
 * A workspace invitation as the UI and the wire see it. The invitee's address
 * is the identity here — the plugin keys acceptance on it, and the invited
 * person has no user row of ours until they accept.
 */
export const Invitation = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  role: WorkspaceRole,
  status: InvitationStatus,
  expiresAt: Schema.String
})
export type Invitation = typeof Invitation.Type

export type CreateInvitationInput = {
  readonly email: string
  readonly role: WorkspaceRole
}

export type InvitationRef = {
  readonly invitationId: string
}

/**
 * Who is accepting. The email rides along because the invitation is addressed
 * to an address, not to a user id: both adapters refuse an invitation the
 * signed-in person is not the recipient of, and Seed has no `user` table to
 * look one up in.
 */
export type AcceptInvitationInput = InvitationRef & {
  readonly userId: string
  readonly email: string
}

/**
 * An invitation plus the workspace it belongs to. The accept page holds only an
 * invitation id — it cannot resolve the workspace by slug, because it is not
 * allowed to look one up until the invitation makes it a member — so the
 * workspace's public fields ride along with the read.
 */
export const InvitationDetail = Schema.Struct({
  ...Invitation.fields,
  workspaceSlug: Schema.String,
  workspaceName: Schema.String
})
export type InvitationDetail = typeof InvitationDetail.Type

/** What the accept route needs to send the new member on their way. */
export const AcceptedInvitation = Schema.Struct({
  workspaceSlug: Schema.String,
  workspaceName: Schema.String,
  role: WorkspaceRole
})
export type AcceptedInvitation = typeof AcceptedInvitation.Type

export type WorkspaceInvitationsInterface = {
  /** Every invitation of the current workspace, newest first. */
  readonly list: Effect.Effect<
    readonly Invitation[],
    CapabilityUnavailable,
    WorkspaceContext
  >
  readonly create: (
    input: CreateInvitationInput
  ) => Effect.Effect<
    Invitation,
    CapabilityUnavailable | MembershipChangeRejected,
    WorkspaceContext
  >
  readonly cancel: (
    input: InvitationRef
  ) => Effect.Effect<
    void,
    CapabilityUnavailable | MembershipChangeRejected,
    WorkspaceContext
  >
  /**
   * One invitation by id, with its workspace. No `WorkspaceContext` and no
   * membership check, for the same reason `accept` has neither — this is the
   * read the accept page makes before anyone is a member.
   *
   * It discloses the invited address to whoever holds the id. Callers decide
   * what to show: `acceptInvitationDetailsServerFn` reveals the workspace only
   * once the signed-in address matches.
   */
  readonly find: (
    invitationId: string
  ) => Effect.Effect<Option.Option<InvitationDetail>, CapabilityUnavailable>
  /**
   * Accepts an invitation and makes its recipient a member.
   *
   * Deliberately free of `WorkspaceContext`: the person accepting is not a
   * member yet, and `liveWorkspaceContext(slug, actor)` refuses a non-member by
   * design, so an accept behind it could never succeed. The invitation id is
   * the key, and the workspace is resolved from the invitation itself — the
   * same shape as `WorkspaceMembership.listWorkspacesForUser`, which is keyed
   * by user id for the same reason.
   */
  readonly accept: (
    input: AcceptInvitationInput
  ) => Effect.Effect<
    AcceptedInvitation,
    CapabilityUnavailable | MembershipChangeRejected
  >
}

export class WorkspaceInvitations extends Context.Service<
  WorkspaceInvitations,
  WorkspaceInvitationsInterface
>()('@b2b-saas-starter/capabilities/WorkspaceInvitations') {}

/**
 * The write half of invitations, as this package needs it — a structural port,
 * not the plugin's wire shape, for the same reason `WorkspaceMemberBinding`
 * is one: `capabilities` never names Better Auth, and every invitation
 * endpoint the plugin exposes is `requireHeaders: true`, so only the app can
 * supply the session they demand.
 */
export type WorkspaceInvitationBinding = {
  readonly create: (input: {
    readonly workspaceId: string
    readonly email: string
    readonly role: WorkspaceRole
  }) => Promise<void>
  readonly cancel: (input: { readonly invitationId: string }) => Promise<void>
  /**
   * Takes no user: the plugin reads the accepting user from the session the
   * app's adapter supplies, and refuses an invitation addressed elsewhere.
   */
  readonly accept: (input: { readonly invitationId: string }) => Promise<void>
}

const noBinding = new CapabilityUnavailable({
  capability: 'workspace-invitations',
  reason: 'no_invitation_binding'
})

/**
 * A 4xx from the plugin means the workspace refused the invitation — an address
 * that is already a member, an address already invited, a role it will not
 * accept. Anything else is the store failing. Same classification as
 * `workspace-membership.ts`, and getting it backwards tells a caller to retry a
 * request that can never succeed.
 */
function classifyBindingFailure(
  cause: unknown
): CapabilityUnavailable | MembershipChangeRejected {
  const failure = readPluginBindingFailure(cause)
  if (failure.refusedByWorkspace) {
    return new MembershipChangeRejected({ reason: failure.reason })
  }
  return new CapabilityUnavailable({
    capability: 'workspace-invitations',
    reason: failure.reason
  })
}

/** How long a fixture invitation stays pending — the plugin's own 48 hours. */
const SEED_INVITATION_TTL_MS = 48 * 60 * 60 * 1000

/**
 * The invitation state machine's own rules, written once so both adapters
 * refuse the same things. Live checks them before it calls the plugin: the
 * plugin enforces them too, but only a pre-check makes the capability's answer
 * independent of which binding is wired, and the audit event needs the row
 * anyway.
 */
function requireRecipient(
  invitation: Invitation,
  email: string
): Effect.Effect<void, MembershipChangeRejected> {
  // The plugin lower-cases both sides before comparing; matching that keeps a
  // mixed-case sign-up from being refused its own invitation.
  if (invitation.email.toLowerCase() !== email.toLowerCase()) {
    return Effect.fail(new MembershipChangeRejected({ reason: 'not_the_recipient' }))
  }
  return Effect.void
}

function requireUnexpired(
  invitation: Invitation
): Effect.Effect<void, MembershipChangeRejected> {
  return Effect.gen(function* () {
    const now = yield* DateTime.now
    const expiresAt = DateTime.makeUnsafe(invitation.expiresAt)
    if (DateTime.toEpochMillis(expiresAt) < DateTime.toEpochMillis(now)) {
      return yield* Effect.fail(
        new MembershipChangeRejected({ reason: 'invitation_expired' })
      )
    }
  })
}

/** Moves a stored fixture invitation to a terminal status. */
function settle(
  store: Ref.Ref<readonly Invitation[]>,
  invitationId: string,
  status: InvitationStatus
): Effect.Effect<void> {
  return Ref.update(store, (rows) =>
    rows.map((row) => {
      if (row.id !== invitationId) return row
      return { ...row, status }
    })
  )
}

/**
 * Fails the way the Live adapter fails for an invitation this workspace cannot
 * act on, so the shared contract holds on both sides.
 */
function requirePending(
  store: Ref.Ref<readonly Invitation[]>,
  invitationId: string
): Effect.Effect<Invitation, MembershipChangeRejected> {
  return Ref.get(store).pipe(
    Effect.flatMap((rows) => {
      const found = rows.find((row) => row.id === invitationId)
      if (found?.status !== 'pending') {
        return Effect.fail(
          new MembershipChangeRejected({ reason: 'invitation_not_pending' })
        )
      }
      return Effect.succeed(found)
    })
  )
}

/**
 * In-memory invitations, never Better Auth. The store lives in a `Ref` built
 * per layer construction, so a mutation is observable within the request or
 * test that made it and no state leaks into the next one.
 */
export function SeedWorkspaceInvitations(options: {
  /**
   * The same roster `SeedWorkspaceMembership` serves. Accepting an invitation
   * adds a member, and the two seed adapters must agree about who is one.
   */
  readonly roster: SeedRoster
  /** The fixture workspace every seed invitation belongs to. */
  readonly workspace: Workspace
  readonly seed?: readonly Invitation[]
}): Layer.Layer<WorkspaceInvitations> {
  return Layer.effect(WorkspaceInvitations)(
    Effect.gen(function* () {
      const store = yield* Ref.make<readonly Invitation[]>(options.seed ?? [])

      return {
        list: Ref.get(store),
        find: (invitationId) =>
          Ref.get(store).pipe(
            Effect.map((rows) => {
              const found = rows.find((row) => row.id === invitationId)
              if (!found) return Option.none()
              return Option.some({
                ...found,
                workspaceSlug: options.workspace.slug,
                workspaceName: options.workspace.name
              })
            })
          ),
        create: (input) =>
          Effect.gen(function* () {
            const current = yield* Ref.get(store)
            const alreadyInvited = current.some(
              (each) => each.email === input.email && each.status === 'pending'
            )
            if (alreadyInvited) {
              return yield* Effect.fail(
                new MembershipChangeRejected({ reason: 'already_invited' })
              )
            }
            const id = yield* newCapabilityId('inv')
            const now = yield* DateTime.now
            const created: Invitation = {
              id,
              email: input.email,
              role: input.role,
              status: 'pending',
              expiresAt: DateTime.formatIso(
                DateTime.addDuration(now, SEED_INVITATION_TTL_MS)
              )
            }
            yield* Ref.update(store, (rows) => [created, ...rows])
            return created
          }),
        cancel: (input) =>
          Effect.gen(function* () {
            yield* requirePending(store, input.invitationId)
            yield* settle(store, input.invitationId, 'canceled')
          }),
        accept: (input) =>
          Effect.gen(function* () {
            const pending = yield* requirePending(store, input.invitationId)
            yield* requireRecipient(pending, input.email)
            yield* requireUnexpired(pending)

            yield* settle(store, input.invitationId, 'accepted')
            // No `user` table to join, so the fixture fabricates the identity
            // fields the way `SeedWorkspaceMembership.addMember` does.
            const joined: Member = {
              id: input.userId,
              name: input.userId,
              email: input.email,
              role: pending.role,
              systemRole: 'user'
            }
            yield* Ref.update(options.roster, (current) => [...current, joined])
            return {
              workspaceSlug: options.workspace.slug,
              workspaceName: options.workspace.name,
              role: pending.role
            }
          })
      }
    })
  )
}

/** Maps a stored row onto the wire DTO. The row's dates are epoch integers. */
function toInvitation(row: typeof workspaceInvitations.$inferSelect): Invitation {
  return {
    id: row.id,
    email: row.email,
    // The column is nullable — the plugin lets an invitation fall back to its
    // default role on accept. The starter always sends one, so a null here is
    // an invitation the plugin created outside this capability.
    role: row.role ?? 'member',
    status: row.status,
    expiresAt: row.expiresAt.toISOString()
  }
}

export function LiveWorkspaceInvitations(
  binding?: WorkspaceInvitationBinding
): Layer.Layer<WorkspaceInvitations, never, Database | AuditEventLog> {
  return Layer.effect(WorkspaceInvitations)(
    Effect.gen(function* () {
      const db = yield* Database
      const audit = yield* AuditEventLog

      const unavailable = orUnavailable('workspace-invitations')

      const callBinding = Effect.fnUntraced(function* (
        call: (bound: WorkspaceInvitationBinding) => Promise<void>
      ) {
        if (!binding) return yield* Effect.fail(noBinding)
        return yield* Effect.tryPromise({
          try: () => call(binding),
          catch: classifyBindingFailure
        })
      })

      /**
       * Reads the invitation back through the same table `list` reads, rather
       * than trusting the binding's return value: the plugin's response shape
       * is exactly what this package refuses to name.
       */
      const readPending = Effect.fnUntraced(function* (
        workspaceId: string,
        email: string
      ) {
        const rows = yield* unavailable(pendingByEmail(db, workspaceId, email).limit(1))
        const row = rows[0]
        if (!row) {
          return yield* Effect.fail(
            new MembershipChangeRejected({ reason: 'invitation_not_created' })
          )
        }
        return toInvitation(row)
      })

      /**
       * One invitation with its workspace, keyed by id alone. Both the accept
       * path and the accept page's read go through here: neither has a slug to
       * resolve a `WorkspaceContext` from.
       */
      const findJoined = Effect.fnUntraced(function* (invitationId: string) {
        const rows = yield* unavailable(
          db
            .select({ invitation: workspaceInvitations, workspace: workspaces })
            .from(workspaceInvitations)
            .innerJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspaceId))
            .where(eq(workspaceInvitations.id, invitationId))
            .limit(1)
        )
        return Option.fromUndefinedOr(rows[0])
      })

      /**
       * Scopes the invitation to the calling workspace before the plugin is
       * touched. The plugin would answer for any invitation the session may
       * cancel; this capability answers only for the workspace in context.
       */
      const requirePendingInWorkspace = Effect.fnUntraced(function* (
        workspaceId: string,
        invitationId: string
      ) {
        const rows = yield* unavailable(
          db
            .select()
            .from(workspaceInvitations)
            .where(
              and(
                eq(workspaceInvitations.id, invitationId),
                eq(workspaceInvitations.workspaceId, workspaceId),
                eq(workspaceInvitations.status, 'pending')
              )
            )
            .limit(1)
        )
        const row = rows[0]
        if (!row) {
          return yield* Effect.fail(
            new MembershipChangeRejected({ reason: 'invitation_not_pending' })
          )
        }
        return toInvitation(row)
      })

      return {
        list: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const rows = yield* unavailable(
            db
              .select()
              .from(workspaceInvitations)
              .where(eq(workspaceInvitations.workspaceId, ctx.workspace.id))
          )
          return rows.map(toInvitation)
        }),
        find: (invitationId) =>
          findJoined(invitationId).pipe(
            Effect.map(
              Option.map((row) => ({
                ...toInvitation(row.invitation),
                workspaceSlug: row.workspace.slug,
                workspaceName: row.workspace.name
              }))
            )
          ),
        create: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            yield* callBinding((bound) =>
              bound.create({
                workspaceId: ctx.workspace.id,
                email: input.email,
                role: input.role
              })
            )
            const created = yield* readPending(ctx.workspace.id, input.email)
            // Not atomic with the write above, and it cannot be: D1 rejects an
            // explicit BEGIN, and a plugin write cannot join a `batch()`. The
            // same accepted trade `workspace-membership.ts` records.
            yield* audit.record({
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              eventType: 'workspace_invitation.sent',
              targetType: 'workspace_invitation',
              targetId: created.id,
              metadata: { email: input.email, role: input.role }
            })
            return created
          }),
        cancel: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const pending = yield* requirePendingInWorkspace(
              ctx.workspace.id,
              input.invitationId
            )
            yield* callBinding((bound) =>
              bound.cancel({ invitationId: input.invitationId })
            )
            yield* audit.record({
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              eventType: 'workspace_invitation.canceled',
              targetType: 'workspace_invitation',
              targetId: input.invitationId,
              metadata: { email: pending.email }
            })
          }),
        accept: (input) =>
          Effect.gen(function* () {
            // No `WorkspaceContext` to read: the invitation names its own
            // workspace, which is the only way an accept can work for someone
            // the workspace does not yet contain.
            const joined = yield* findJoined(input.invitationId)
            if (Option.isNone(joined) || joined.value.invitation.status !== 'pending') {
              return yield* Effect.fail(
                new MembershipChangeRejected({ reason: 'invitation_not_pending' })
              )
            }
            const row = joined.value
            const pending = toInvitation(row.invitation)
            yield* requireRecipient(pending, input.email)
            yield* requireUnexpired(pending)

            // The plugin settles the invitation and creates the member row in
            // one call; this capability never writes either itself.
            yield* callBinding((bound) =>
              bound.accept({ invitationId: input.invitationId })
            )
            yield* audit.record({
              workspaceId: row.workspace.id,
              actorUserId: input.userId,
              eventType: 'workspace_invitation.accepted',
              targetType: 'workspace_invitation',
              targetId: input.invitationId,
              metadata: { email: pending.email, role: pending.role }
            })
            return {
              workspaceSlug: row.workspace.slug,
              workspaceName: row.workspace.name,
              role: pending.role
            }
          })
      }
    })
  )
}

/** The pending invitation for one address in one workspace, if there is one. */
function pendingByEmail(db: EffectDatabase, workspaceId: string, email: string) {
  return db
    .select()
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        eq(workspaceInvitations.email, email),
        eq(workspaceInvitations.status, 'pending')
      )
    )
}
