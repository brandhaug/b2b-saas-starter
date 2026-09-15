import {
  ASSISTANT_READ_SCOPE,
  ASSISTANT_WRITE_SCOPE,
  assistantPermissionRequest,
  type AssistantCredentialReference
} from '@b2b-saas-starter/authz/assistant-access-token'
import {
  authorize,
  memberPrincipal,
  needsStrongAuthentication
} from '@b2b-saas-starter/authz/client'
import {
  assistantSessionAuthority,
  session,
  user,
  workspaces,
  workspaceMembers,
  twoFactor,
  passkey
} from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import {
  type CapabilityUnavailable,
  orUnavailable
} from '@b2b-saas-starter/failure/capability'
import { and, eq } from 'drizzle-orm'
import { Context, DateTime, Effect, Layer, Schema } from 'effect'
import {
  evaluateStrongAuthentication,
  type SessionEvidence
} from '../governance/strong-authentication.ts'
import { toWorkspace } from '../governance/workspace-identity.ts'
import { type Actor, type WorkspaceContextInterface } from '../workspace-context.ts'
import { McpClientConnections } from './mcp-client-connections.ts'

export type AssistantAuthorityInput = {
  readonly credential: AssistantCredentialReference
  readonly workspaceId: string
  readonly creatorUserId?: string
  readonly requiredPermissions: ReadonlyArray<string>
  readonly operation: 'read' | 'write'
} & (
  | { readonly mode: 'observe' }
  | { readonly mode: 'run'; readonly acceptedAt: number; readonly deadline: number }
)

// oxlint-disable-next-line unicorn/throw-new-error -- Effect tagged error factory
export class AssistantAuthorityDenied extends Schema.TaggedError<AssistantAuthorityDenied>()(
  'AssistantAuthorityDenied',
  {
    reason: Schema.Literals([
      'not_found',
      'credential_expired',
      'scope_required',
      'policy_denied'
    ])
  }
) {}

export type AssistantAuthorizedContext = WorkspaceContextInterface & {
  readonly actor: Actor
}

export class AssistantAuthority extends Context.Service<
  AssistantAuthority,
  {
    readonly authorize: (
      input: AssistantAuthorityInput
    ) => Effect.Effect<
      AssistantAuthorizedContext,
      AssistantAuthorityDenied | CapabilityUnavailable
    >
  }
>()('@b2b-saas-starter/capabilities/AssistantAuthority') {}

/** Current rows only. A retained session proves expiry, never membership or consent. */
export type AssistantAuthorityState = {
  readonly context: AssistantAuthorizedContext
  readonly banned: boolean
  readonly suspended: boolean
  readonly currentSession: SessionEvidence | null
  readonly retainedSession:
    | (SessionEvidence & { readonly revokedAt: Date | null })
    | null
  readonly totpId: string | null
  readonly passkeyIds: ReadonlyArray<string>
  readonly grant: {
    readonly binding: string
    readonly scopes: ReadonlyArray<string>
  } | null
}

function authorityService(
  resource: string | undefined,
  read: (
    input: AssistantAuthorityInput
  ) => Effect.Effect<AssistantAuthorityState | null, CapabilityUnavailable>
): AssistantAuthority['Service'] {
  return {
    authorize: Effect.fn('AssistantAuthority.authorize')(function* (input) {
      const credential = input.credential
      const checkedAt = yield* DateTime.now
      const now = DateTime.toEpochMillis(checkedAt)
      if (
        input.creatorUserId !== undefined &&
        input.creatorUserId !== credential.userId
      ) {
        return yield* new AssistantAuthorityDenied({ reason: 'not_found' })
      }
      if (input.mode === 'observe' && credential.expiresAt <= now) {
        return yield* new AssistantAuthorityDenied({ reason: 'credential_expired' })
      }
      if (
        input.mode === 'run' &&
        (input.acceptedAt > now ||
          input.deadline <= now ||
          input.deadline <= input.acceptedAt ||
          credential.expiresAt <= input.acceptedAt)
      ) {
        return yield* new AssistantAuthorityDenied({ reason: 'credential_expired' })
      }
      if (
        credential.kind === 'oauth' &&
        (credential.workspaceId !== input.workspaceId ||
          !resource ||
          credential.resource !== resource)
      ) {
        return yield* new AssistantAuthorityDenied({ reason: 'not_found' })
      }
      const state = yield* read(input)
      if (
        state === null ||
        state.context.actor.userId !== credential.userId ||
        state.context.workspace.id !== input.workspaceId
      ) {
        return yield* new AssistantAuthorityDenied({ reason: 'not_found' })
      }
      if (state.banned || state.suspended) {
        return yield* new AssistantAuthorityDenied({ reason: 'policy_denied' })
      }
      const retained = state.retainedSession
      if (retained?.revokedAt !== null && retained?.revokedAt !== undefined) {
        return yield* new AssistantAuthorityDenied({ reason: 'policy_denied' })
      }
      const allowNaturalSessionExpiry =
        input.mode === 'run' || credential.kind === 'oauth'
      let proof = state.currentSession
      if (allowNaturalSessionExpiry) {
        // A missing unexpired session is revocation even if a hook failed. Only
        // natural expiry can use retained proof, and never without its row.
        if (!retained || (proof === null && retained.expiresAt.getTime() > now)) {
          return yield* new AssistantAuthorityDenied({ reason: 'policy_denied' })
        }
        proof ??= retained
      }
      if (
        !proof ||
        (!allowNaturalSessionExpiry && proof.expiresAt.getTime() <= now) ||
        proof.impersonatedBy !== null ||
        (proof.recoveryUntil !== null && proof.recoveryUntil.getTime() > now)
      ) {
        return yield* new AssistantAuthorityDenied({ reason: 'policy_denied' })
      }
      let scope = ASSISTANT_READ_SCOPE
      if (input.operation === 'write') {
        scope = ASSISTANT_WRITE_SCOPE
      }
      if (
        credential.kind === 'oauth' &&
        (!credential.scopes.includes(scope) ||
          state.grant?.binding !== credential.consentBinding ||
          !state.grant.scopes.includes(scope))
      ) {
        return yield* new AssistantAuthorityDenied({ reason: 'scope_required' })
      }
      const principal = memberPrincipal(state.context.actor.role)
      for (const requirement of ['assistant:read', ...input.requiredPermissions]) {
        const permission = assistantPermissionRequest(requirement)
        if (permission === null || !authorize(principal, permission).success) {
          return yield* new AssistantAuthorityDenied({ reason: 'not_found' })
        }
      }
      if (
        needsStrongAuthentication({
          workspaceRole: state.context.actor.role,
          systemRole: state.context.actor.systemRole
        }) &&
        !evaluateStrongAuthentication(
          proof,
          state.totpId,
          state.passkeyIds,
          DateTime.toDate(checkedAt),
          allowNaturalSessionExpiry
        ).qualified
      ) {
        return yield* new AssistantAuthorityDenied({ reason: 'policy_denied' })
      }
      return state.context
    })
  }
}

/** Explicit fixture adapter. Callers mutate their fixture to model authority changes. */
export function SeedAssistantAuthority(
  resource: string | undefined,
  current: (
    input: AssistantAuthorityInput
  ) => Effect.Effect<AssistantAuthorityState | null, CapabilityUnavailable>
): Layer.Layer<AssistantAuthority> {
  return Layer.succeed(AssistantAuthority)(authorityService(resource, current))
}

export function LiveAssistantAuthority(
  resource: string | undefined
): Layer.Layer<AssistantAuthority, never, Database | McpClientConnections> {
  return Layer.effect(AssistantAuthority)(
    Effect.gen(function* () {
      const db = yield* Database
      const connections = yield* McpClientConnections
      const unavailable = orUnavailable('assistant-authority')
      return authorityService(
        resource,
        Effect.fn('AssistantAuthority.read')(function* (input) {
          const credential = input.credential
          const [identity] = yield* unavailable(
            db
              .select({ member: workspaceMembers, user, workspace: workspaces })
              .from(workspaceMembers)
              .innerJoin(user, eq(user.id, workspaceMembers.userId))
              .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
              .where(
                and(
                  eq(workspaceMembers.workspaceId, input.workspaceId),
                  eq(workspaceMembers.userId, credential.userId)
                )
              )
              .limit(1)
          )
          if (!identity) {
            return null
          }
          const [currentSession] = yield* unavailable(
            db
              .select()
              .from(session)
              .where(
                and(
                  eq(session.id, credential.sessionId),
                  eq(session.userId, credential.userId)
                )
              )
              .limit(1)
          )
          const [retainedSession] = yield* unavailable(
            db
              .select()
              .from(assistantSessionAuthority)
              .where(
                and(
                  eq(assistantSessionAuthority.sessionId, credential.sessionId),
                  eq(assistantSessionAuthority.userId, credential.userId)
                )
              )
              .limit(1)
          )
          const [totp] = yield* unavailable(
            db
              .select({ id: twoFactor.id })
              .from(twoFactor)
              .where(
                and(
                  eq(twoFactor.userId, credential.userId),
                  eq(twoFactor.verified, true)
                )
              )
              .limit(1)
          )
          const keys = yield* unavailable(
            db
              .select({ id: passkey.id })
              .from(passkey)
              .where(eq(passkey.userId, credential.userId))
          )
          let grant: AssistantAuthorityState['grant'] = null
          if (credential.kind === 'oauth') {
            grant = yield* connections.getGrant({
              userId: credential.userId,
              workspaceId: input.workspaceId,
              clientId: credential.clientId,
              resource: credential.resource
            })
          }
          return {
            context: {
              workspace: toWorkspace(identity.workspace),
              actor: {
                userId: identity.user.id,
                role: identity.member.role,
                systemRole: identity.user.role ?? 'user'
              },
              actorType: 'user'
            },
            banned: identity.user.banned ?? false,
            suspended: identity.workspace.suspensionStatus !== 'active',
            currentSession: currentSession ?? null,
            retainedSession: retainedSession ?? null,
            totpId: totp?.id ?? null,
            passkeyIds: keys.map((key) => key.id),
            grant
          }
        })
      )
    })
  )
}
