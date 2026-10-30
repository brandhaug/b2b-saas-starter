import { readRootDataHandler } from '../../lib/server/root-data.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/root-data'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group.handle('rootDataServerFn', () => invoke(() => readRootDataHandler()))
)
export { Api }
