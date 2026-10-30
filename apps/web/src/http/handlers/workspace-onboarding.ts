import { dismissOnboardingChecklistHandler } from '../../lib/server/workspace-onboarding.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/workspace-onboarding'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group.handle('dismissOnboardingChecklistServerFn', ({ payload }) =>
    invoke(() => dismissOnboardingChecklistHandler(payload))
  )
)
export { Api }
