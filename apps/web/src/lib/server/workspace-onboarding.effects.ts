import { WorkspaceOnboarding } from '@b2b-saas-starter/capabilities/governance/workspace-onboarding'
import { Effect } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { type DismissInput } from './workspace-onboarding'

export async function dismissOnboardingChecklistHandler(
  input: DismissInput
): Promise<boolean> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      // Proves the actor may dismiss (`onboarding:dismiss` — owner and
      // admin, never member), then hands the mutation to the capability.
      // Resolves `false` when the workspace had already dismissed — no
      // second audit row.
      yield* requireWorkspacePermission({ onboarding: ['dismiss'] })
      const onboarding = yield* WorkspaceOnboarding
      return yield* onboarding.dismiss
    }),
    { userId: session.user.id }
  )
}
