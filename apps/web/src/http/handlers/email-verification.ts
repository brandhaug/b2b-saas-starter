import { readEmailVerificationStatusHandler } from '../../lib/server/email-verification.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/email-verification'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group.handle('getEmailVerificationStatusServerFn', () =>
    invoke(() => readEmailVerificationStatusHandler())
  )
)
export { Api }
