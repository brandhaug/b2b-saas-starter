import {
  type ConversationSummary,
  type ConversationList,
  type ConversationPage,
  type ConversationAcceptance,
  type ConversationAttempt
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

export type ConversationHistory = typeof ConversationPage.Type
export type ConversationResult<A> =
  | { readonly ok: true; readonly value: A }
  | {
      readonly ok: false
      readonly reason:
        | 'configuration'
        | 'provider'
        | 'unavailable'
        | 'not_found'
        | 'access'
        | 'busy'
        | 'conflict'
        | 'limit'
        | 'input'
      readonly message: string
      readonly retryAfterSeconds: number | null
    }

const WorkspaceInput = Schema.Struct({ workspaceSlug: Schema.NonEmptyString })
const ListInput = Schema.Struct({
  ...WorkspaceInput.fields,
  cursor: Schema.optionalKey(Schema.String)
})
const ConversationInput = Schema.Struct({
  ...WorkspaceInput.fields,
  conversationId: Schema.NonEmptyString
})
const HistoryInput = Schema.Struct({
  ...ConversationInput.fields,
  cursor: Schema.optionalKey(Schema.String)
})
const SendInput = Schema.Struct({
  ...ConversationInput.fields,
  idempotencyKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  question: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
  taskId: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
  )
})
const AttemptInput = Schema.Struct({
  ...ConversationInput.fields,
  attemptId: Schema.NonEmptyString
})
const RetryInput = Schema.Struct({
  ...AttemptInput.fields,
  idempotencyKey: SendInput.fields.idempotencyKey
})
export type ConversationWorkspaceInput = typeof WorkspaceInput.Type
export type ConversationListInput = typeof ListInput.Type
export type ConversationReadInput = typeof ConversationInput.Type
export type ConversationHistoryInput = typeof HistoryInput.Type
export type ConversationSendInput = typeof SendInput.Type
export type ConversationAttemptInput = typeof AttemptInput.Type
export type ConversationRetryInput = typeof RetryInput.Type

export const createConversationServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(WorkspaceInput))
  .handler(async ({ data }): Promise<ConversationResult<ConversationSummary>> => {
    const { createConversationHandler } =
      await import('./assistant-conversations.effects')
    return createConversationHandler(data)
  })
export const listConversationsServerFn = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(ListInput))
  .handler(async ({ data }): Promise<ConversationResult<ConversationList>> => {
    const { listConversationsHandler } =
      await import('./assistant-conversations.effects')
    return listConversationsHandler(data)
  })
export const readConversationServerFn = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(ConversationInput))
  .handler(async ({ data }): Promise<ConversationResult<ConversationSummary>> => {
    const { readConversationHandler } =
      await import('./assistant-conversations.effects')
    return readConversationHandler(data)
  })
export const conversationHistoryServerFn = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(HistoryInput))
  .handler(async ({ data }): Promise<ConversationResult<ConversationHistory>> => {
    const { conversationHistoryHandler } =
      await import('./assistant-conversations.effects')
    return conversationHistoryHandler(data)
  })
export const sendConversationServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(SendInput))
  .handler(async ({ data }): Promise<ConversationResult<ConversationAcceptance>> => {
    const { sendConversationHandler } =
      await import('./assistant-conversations.effects')
    return sendConversationHandler(data)
  })
export const retryConversationServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(RetryInput))
  .handler(async ({ data }): Promise<ConversationResult<ConversationAcceptance>> => {
    const { retryConversationHandler } =
      await import('./assistant-conversations.effects')
    return retryConversationHandler(data)
  })
export const stopConversationServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(AttemptInput))
  .handler(async ({ data }): Promise<ConversationResult<ConversationAttempt>> => {
    const { stopConversationHandler } =
      await import('./assistant-conversations.effects')
    return stopConversationHandler(data)
  })
export const deleteConversationServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(ConversationInput))
  .handler(async ({ data }): Promise<ConversationResult<void>> => {
    const { deleteConversationHandler } =
      await import('./assistant-conversations.effects')
    return deleteConversationHandler(data)
  })

/** Components accept the same ports in tests and the authenticated route. */
export type ConversationPorts = {
  readonly create: (input: {
    readonly data: ConversationWorkspaceInput
  }) => Promise<ConversationResult<ConversationSummary>>
  readonly list: (input: {
    readonly data: ConversationListInput
  }) => Promise<ConversationResult<ConversationList>>
  readonly read: (input: {
    readonly data: ConversationReadInput
  }) => Promise<ConversationResult<ConversationSummary>>
  readonly history: (input: {
    readonly data: ConversationHistoryInput
  }) => Promise<ConversationResult<ConversationHistory>>
  readonly send: (input: {
    readonly data: ConversationSendInput
  }) => Promise<ConversationResult<ConversationAcceptance>>
  readonly retry: (input: {
    readonly data: ConversationRetryInput
  }) => Promise<ConversationResult<ConversationAcceptance>>
  readonly stop: (input: {
    readonly data: ConversationAttemptInput
  }) => Promise<ConversationResult<ConversationAttempt>>
  readonly remove: (input: {
    readonly data: ConversationReadInput
  }) => Promise<ConversationResult<void>>
}
