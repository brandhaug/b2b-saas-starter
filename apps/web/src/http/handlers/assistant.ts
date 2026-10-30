import {
  loadAssistantPageHandler,
  askAssistantHandler
} from '../../lib/server/assistant.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/assistant'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('loadAssistantPageServerFn', ({ payload }) =>
      invoke(() => loadAssistantPageHandler(payload))
    )
    .handle('askAssistantServerFn', ({ payload }) =>
      invoke(() => askAssistantHandler(payload))
    )
)
export { Api }
