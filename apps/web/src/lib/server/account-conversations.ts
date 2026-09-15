import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { type ConversationResult } from './assistant-conversations'

/** Identity-owned deletion metadata contains no workspace title or conversation content. */
export type OwnedConversation = { readonly id: string; readonly createdAt: string }
const DeleteInput = Schema.Struct({ conversationId: Schema.NonEmptyString })
export const loadOwnedConversationsServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ConversationResult<ReadonlyArray<OwnedConversation>>> => {
    const { loadOwnedConversationsHandler } =
      await import('./account-conversations.effects')
    return loadOwnedConversationsHandler()
  }
)
export const deleteOwnedConversationServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(DeleteInput))
  .handler(async ({ data }): Promise<ConversationResult<void>> => {
    const { deleteOwnedConversationHandler } =
      await import('./account-conversations.effects')
    return deleteOwnedConversationHandler(data)
  })
