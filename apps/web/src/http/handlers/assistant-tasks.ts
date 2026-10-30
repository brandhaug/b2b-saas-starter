import {
  createAssistantTaskHandler,
  getAssistantTaskHandler,
  approveAssistantTaskHandler,
  cancelAssistantTaskHandler
} from '../../lib/server/assistant-tasks.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/assistant-tasks'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('createAssistantTaskServerFn', ({ payload }) =>
      invoke(() => createAssistantTaskHandler(payload))
    )
    .handle('getAssistantTaskServerFn', ({ payload }) =>
      invoke(() => getAssistantTaskHandler(payload))
    )
    .handle('approveAssistantTaskServerFn', ({ payload }) =>
      invoke(() => approveAssistantTaskHandler(payload))
    )
    .handle('cancelAssistantTaskServerFn', ({ payload }) =>
      invoke(() => cancelAssistantTaskHandler(payload))
    )
)
export { Api }
