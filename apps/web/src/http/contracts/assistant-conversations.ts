import {
  ConversationCreateResult,
  ConversationListResult,
  ConversationHistoryResult,
  ConversationAdmissionResult,
  ConversationStopResult,
  ConversationDeletionResult
} from './conversation-records'

export const createConversationServerFnResponse = ConversationCreateResult
export const listConversationsServerFnResponse = ConversationListResult
export const conversationHistoryServerFnResponse = ConversationHistoryResult
export const sendConversationServerFnResponse = ConversationAdmissionResult
export const retryConversationServerFnResponse = ConversationAdmissionResult
export const stopConversationServerFnResponse = ConversationStopResult
export const deleteConversationServerFnResponse = ConversationDeletionResult
