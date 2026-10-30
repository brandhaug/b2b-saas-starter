import { loadDemoShowcase } from '../../lib/server/demo-showcase.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/demo-showcase'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group.handle('loadDemoShowcaseServerFn', () => invoke(() => loadDemoShowcase()))
)
export { Api }
