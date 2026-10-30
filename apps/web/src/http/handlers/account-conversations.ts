import {
  loadOwnedConversationsHandler,
  deleteOwnedConversationHandler
} from '../../lib/server/account-conversations.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/account-conversations'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('loadOwnedConversationsServerFn', () =>
      invoke(() => loadOwnedConversationsHandler())
    )
    .handle('deleteOwnedConversationServerFn', ({ payload }) =>
      invoke(() => deleteOwnedConversationHandler(payload))
    )
)
export { Api }
