import { expect, layer } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import {
  assistantSessionAuthority,
  session,
  user,
  workspaces,
  workspaceMembers,
  oauthClient,
  oauthConsent,
  twoFactor
} from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { eq } from 'drizzle-orm'
import { TestDatabase, LIVE_SUITE_TIMEOUT } from '../testing/live-harness.ts'
import { LiveMcpClientConnections } from './mcp-client-connections.live.ts'
import { LiveAuditEventLog } from '../governance/audit-event-log.live.ts'
import {
  AssistantAuthority,
  LiveAssistantAuthority,
  type AssistantAuthorityState
} from './assistant-authority.ts'
import {
  assistantAuthorityContractCases,
  authorityCredential,
  authorityResource,
  authorityState
} from './assistant-authority.contract.ts'

const insertState = Effect.fn('test.insertAuthorityState')(function* (
  state: AssistantAuthorityState | null
) {
  const db = yield* Database
  yield* db.delete(twoFactor).where(eq(twoFactor.userId, 'usr_authority'))
  yield* db.delete(oauthConsent).where(eq(oauthConsent.id, 'consent_authority'))
  yield* db.delete(session).where(eq(session.id, 'ses_authority'))
  yield* db
    .delete(assistantSessionAuthority)
    .where(eq(assistantSessionAuthority.sessionId, 'ses_authority'))
  yield* db
    .delete(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, 'wrk_authority'))
  if (state === null) {
    return
  }
  const actor = state.context.actor
  yield* db
    .insert(user)
    .values({
      id: actor.userId,
      name: 'Authority',
      email: 'authority@test.local',
      role: actor.systemRole,
      banned: state.banned
    })
    .onConflictDoUpdate({
      target: user.id,
      set: { role: actor.systemRole, banned: state.banned }
    })
  if (state.totpId) {
    yield* db.insert(twoFactor).values({
      id: state.totpId,
      userId: actor.userId,
      secret: 'fixture-factor',
      backupCodes: '[]',
      verified: true
    })
  }
  let suspensionStatus: 'active' | 'suspended' = 'active'
  if (state.suspended) {
    suspensionStatus = 'suspended'
  }
  yield* db
    .insert(workspaces)
    .values({ ...state.context.workspace, suspensionStatus })
    .onConflictDoUpdate({ target: workspaces.id, set: { suspensionStatus } })
  yield* db.insert(workspaceMembers).values({
    id: 'member_authority',
    workspaceId: 'wrk_authority',
    userId: actor.userId,
    role: actor.role
  })
  if (state.currentSession) {
    yield* db.insert(session).values({
      ...state.currentSession,
      id: authorityCredential.sessionId,
      userId: actor.userId,
      token: 'test-authority-session-secret'
    })
  }
  if (state.retainedSession) {
    yield* db
      .insert(assistantSessionAuthority)
      .values({
        ...state.retainedSession,
        sessionId: authorityCredential.sessionId,
        userId: actor.userId
      })
      .onConflictDoUpdate({
        target: assistantSessionAuthority.sessionId,
        set: state.retainedSession
      })
  } else {
    yield* db
      .delete(assistantSessionAuthority)
      .where(eq(assistantSessionAuthority.sessionId, authorityCredential.sessionId))
  }
  yield* db
    .insert(oauthClient)
    .values({
      id: 'client_authority',
      clientId: 'authority-client',
      redirectUris: ['https://client.example/callback']
    })
    .onConflictDoNothing()
  if (state.grant) {
    yield* db.insert(oauthConsent).values({
      id: 'consent_authority',
      clientId: 'authority-client',
      userId: actor.userId,
      referenceId: 'wrk_authority',
      grantVersion: Number(state.grant.binding.split(':')[1]),
      scopes: [...state.grant.scopes],
      resources: [authorityResource]
    })
  }
})

const authority = LiveAssistantAuthority(authorityResource).pipe(
  Layer.provide(LiveMcpClientConnections().pipe(Layer.provide(LiveAuditEventLog)))
)
layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live assistant authority',
  (it) => {
    it.effect(
      'uses ordinary user defaults when optional persisted identity flags are absent',
      () =>
        Effect.gen(function* () {
          yield* insertState(authorityState)
          const db = yield* Database
          yield* db
            .update(user)
            .set({ role: null, banned: null })
            .where(eq(user.id, authorityCredential.userId))
          const context = yield* Effect.gen(function* () {
            const service = yield* AssistantAuthority
            return yield* service.authorize({
              credential: authorityCredential,
              workspaceId: 'wrk_authority',
              requiredPermissions: [],
              operation: 'read',
              mode: 'observe'
            })
          }).pipe(Effect.provide(authority))
          expect(context.actor.systemRole).toBe('user')
          expect(context.actor.userId).toBe(authorityCredential.userId)
        })
    )
    for (const scenario of assistantAuthorityContractCases(expect)) {
      it.effect(scenario.name, () =>
        Effect.gen(function* () {
          yield* insertState(scenario.state)
          yield* scenario.assert.pipe(Effect.provide(authority))
        })
      )
    }
  }
)
