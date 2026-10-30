import {
  readStrongAuthenticationStatus,
  verifyCurrentPassword
} from '../../lib/server/strong-authentication.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/strong-authentication'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('strongAuthenticationStatusServerFn', () =>
      invoke(() => readStrongAuthenticationStatus())
    )
    .handle('verifyCurrentPasswordServerFn', ({ payload }) =>
      invoke(() => verifyCurrentPassword(payload.password))
    )
)
export { Api }
