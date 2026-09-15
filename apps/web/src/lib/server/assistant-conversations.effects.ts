import { type AssistantCredentialReference } from '@b2b-saas-starter/authz/assistant-access-token'
import {
  AssistantConversations,
  type ConversationError
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversations'
import { ConversationNotFound } from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { Effect } from 'effect'
import { m } from '@b2b-saas-starter/i18n/messages'
import { type Session } from '@b2b-saas-starter/auth'
import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import {
  type ConversationResult,
  type ConversationWorkspaceInput,
  type ConversationListInput,
  type ConversationReadInput,
  type ConversationHistoryInput,
  type ConversationSendInput,
  type ConversationAttemptInput,
  type ConversationRetryInput
} from './assistant-conversations'

function credentialFor(session: Session): AssistantCredentialReference {
  return {
    kind: 'session',
    userId: session.user.id,
    sessionId: session.session.id,
    expiresAt: session.session.expiresAt.getTime()
  }
}

function refusal(
  error: ConversationError
): Extract<ConversationResult<never>, { readonly ok: false }> {
  let reason: Extract<ConversationResult<never>, { readonly ok: false }>['reason'] =
    'unavailable'
  let message = m.assistant_conversations_unavailable()
  let retryAfterSeconds: number | null = null
  switch (error._tag) {
    case 'ConversationUnavailable': {
      if (error.reason === 'configuration') {
        reason = 'configuration'
        message = m.assistant_conversations_configuration()
      }
      if (error.reason === 'provider') {
        reason = 'provider'
        message = m.assistant_conversations_provider_failed()
      }
      break
    }
    case 'ConversationNotFound': {
      reason = 'not_found'
      message = m.assistant_conversations_not_found()
      break
    }
    case 'AssistantAuthorityDenied': {
      reason = 'access'
      message = m.assistant_conversations_access_lost()
      break
    }
    case 'ConversationConflict': {
      reason = 'conflict'
      message = m.assistant_conversations_conflict()
      if (error.reason === 'busy') {
        reason = 'busy'
        message = m.assistant_conversations_busy()
      }
      break
    }
    case 'AssistantAdmissionRefused': {
      reason = 'limit'
      retryAfterSeconds = error.retryAfterSeconds
      message = m.assistant_conversations_limit({ seconds: error.retryAfterSeconds })
      break
    }
    case 'ConversationInputRejected': {
      reason = 'input'
      message = m.assistant_conversations_input_rejected()
      break
    }
    case 'CapabilityUnavailable': {
      break
    }
  }
  return { ok: false, reason, message, retryAfterSeconds }
}

function outcome<A, R>(effect: Effect.Effect<A, ConversationError, R>) {
  return effect.pipe(
    Effect.match({
      onFailure: refusal,
      onSuccess: (value): ConversationResult<A> => ({ ok: true, value })
    })
  )
}

const requireConversationWorkspace = Effect.fn(
  'WebAssistant.requireConversationWorkspace'
)(function* (credential: AssistantCredentialReference, conversationId: string) {
  const service = yield* AssistantConversations
  const context = yield* WorkspaceContext
  const summary = yield* service.read({ credential, conversationId })
  if (summary.workspaceId !== context.workspace.id) {
    return yield* new ConversationNotFound()
  }
  return service
})

export async function createConversationHandler(input: ConversationWorkspaceInput) {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ assistant: ['read'] })
      const conversations = yield* AssistantConversations
      return yield* outcome(
        conversations.create({ credential: credentialFor(session) })
      )
    }),
    { userId: session.user.id }
  )
}
export async function listConversationsHandler(input: ConversationListInput) {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ assistant: ['read'] })
      const conversations = yield* AssistantConversations
      return yield* outcome(
        conversations.list({
          credential: credentialFor(session),
          cursor: input.cursor,
          limit: 20
        })
      )
    }),
    { userId: session.user.id }
  )
}
export async function readConversationHandler(input: ConversationReadInput) {
  const session = await requireRequestSession()
  const credential = credentialFor(session)
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ assistant: ['read'] })
      return yield* outcome(
        Effect.gen(function* () {
          const conversations = yield* requireConversationWorkspace(
            credential,
            input.conversationId
          )
          return yield* conversations.read({
            credential,
            conversationId: input.conversationId
          })
        })
      )
    }),
    { userId: session.user.id }
  )
}
export async function conversationHistoryHandler(input: ConversationHistoryInput) {
  const session = await requireRequestSession()
  const credential = credentialFor(session)
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ assistant: ['read'] })
      return yield* outcome(
        Effect.gen(function* () {
          const conversations = yield* requireConversationWorkspace(
            credential,
            input.conversationId
          )
          return yield* conversations.history({
            credential,
            conversationId: input.conversationId,
            cursor: input.cursor
          })
        })
      )
    }),
    { userId: session.user.id }
  )
}
export async function sendConversationHandler(input: ConversationSendInput) {
  const session = await requireRequestSession()
  const credential = credentialFor(session)
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ assistant: ['read'] })
      return yield* outcome(
        Effect.gen(function* () {
          const conversations = yield* requireConversationWorkspace(
            credential,
            input.conversationId
          )
          const payload = {
            credential,
            conversationId: input.conversationId,
            idempotencyKey: input.idempotencyKey,
            question: input.question
          }
          if (input.taskId !== undefined) {
            Object.assign(payload, { taskId: input.taskId })
          }
          return yield* conversations.send(payload)
        })
      )
    }),
    { userId: session.user.id }
  )
}
export async function retryConversationHandler(input: ConversationRetryInput) {
  const session = await requireRequestSession()
  const credential = credentialFor(session)
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ assistant: ['read'] })
      return yield* outcome(
        Effect.gen(function* () {
          const conversations = yield* requireConversationWorkspace(
            credential,
            input.conversationId
          )
          return yield* conversations.retry({
            credential,
            conversationId: input.conversationId,
            attemptId: input.attemptId,
            idempotencyKey: input.idempotencyKey
          })
        })
      )
    }),
    { userId: session.user.id }
  )
}
export async function stopConversationHandler(input: ConversationAttemptInput) {
  const session = await requireRequestSession()
  const credential = credentialFor(session)
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ assistant: ['read'] })
      return yield* outcome(
        Effect.gen(function* () {
          const conversations = yield* requireConversationWorkspace(
            credential,
            input.conversationId
          )
          return yield* conversations.stop({
            credential,
            conversationId: input.conversationId,
            attemptId: input.attemptId
          })
        })
      )
    }),
    { userId: session.user.id }
  )
}
export async function deleteConversationHandler(input: ConversationReadInput) {
  const session = await requireRequestSession()
  const credential = credentialFor(session)
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ assistant: ['read'] })
      return yield* outcome(
        Effect.gen(function* () {
          const conversations = yield* requireConversationWorkspace(
            credential,
            input.conversationId
          )
          return yield* conversations.remove({
            credential,
            conversationId: input.conversationId
          })
        })
      )
    }),
    { userId: session.user.id }
  )
}
