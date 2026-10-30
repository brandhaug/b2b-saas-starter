import {
  createConversationHandler,
  listConversationsHandler,
  conversationHistoryHandler,
  sendConversationHandler,
  retryConversationHandler,
  stopConversationHandler,
  deleteConversationHandler
} from '../../lib/server/assistant-conversations.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/assistant-conversations'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('createConversationServerFn', ({ payload }) =>
      invoke(() => createConversationHandler(payload))
    )
    .handle('listConversationsServerFn', ({ payload }) =>
      invoke(() => listConversationsHandler(payload))
    )
    .handle('conversationHistoryServerFn', ({ payload }) =>
      invoke(() => conversationHistoryHandler(payload))
    )
    .handle('sendConversationServerFn', ({ payload }) =>
      invoke(() => sendConversationHandler(payload))
    )
    .handle('retryConversationServerFn', ({ payload }) =>
      invoke(() => retryConversationHandler(payload))
    )
    .handle('stopConversationServerFn', ({ payload }) =>
      invoke(() => stopConversationHandler(payload))
    )
    .handle('deleteConversationServerFn', ({ payload }) =>
      invoke(() => deleteConversationHandler(payload))
    )
)
export { Api }
