import { type AssistantCredentialReference } from '@b2b-saas-starter/authz/assistant-access-token'
import { type WorkspaceContext } from '../workspace-context.ts'
import {
  demoUserIdentity,
  seedAssistantSessionId,
  seedWorkspaceRecord
} from '../seed-fixture.ts'

export const modelLimits = {
  maxInputTokens: 64_000,
  maxOutputTokens: 16_000,
  providerContextTokens: 128_000,
  providerOutputTokens: 16_000
}
export const credential = {
  kind: 'session',
  userId: demoUserIdentity.id,
  sessionId: seedAssistantSessionId,
  expiresAt: Number.MAX_SAFE_INTEGER
} satisfies AssistantCredentialReference
export const workspace = {
  workspace: seedWorkspaceRecord,
  actor: { userId: demoUserIdentity.id, role: 'owner', systemRole: 'user' },
  actorType: 'user'
} satisfies WorkspaceContext['Service']
