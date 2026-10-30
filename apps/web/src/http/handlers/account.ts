import {
  loadAccountPageHandler,
  exportPersonalDataHandler,
  downloadPersonalDataHandler
} from '../../lib/server/account.effects'
import { deleteAccountHandler } from '../../lib/server/account-delete.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/account'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('loadAccountPageServerFn', () => invoke(() => loadAccountPageHandler()))
    .handle('exportPersonalDataServerFn', () =>
      invoke(() => exportPersonalDataHandler())
    )
    .handle('downloadPersonalDataServerFn', ({ payload }) =>
      invoke(() => downloadPersonalDataHandler(payload))
    )
    .handle('deleteAccountServerFn', ({ payload }) =>
      invoke(() => deleteAccountHandler(payload))
    )
)
export { Api }
