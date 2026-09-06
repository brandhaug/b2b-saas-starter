import { WorkspaceOnboarding } from '@b2b-saas-starter/capabilities/governance/workspace-onboarding'
import { Effect } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { type DismissInput } from './workspace-onboarding'

/**
 * The onboarding dismissal effect and its server-only wiring, reached only
 * through dynamic `import()` inside the handler of
 * `dismissOnboardingChecklistServerFn` (`workspace-onboarding.ts`): handler
 * bodies are stripped from the client build, so this graph ships to the
 * server alone. `workspace-onboarding.ts` holds the client-safe half and the
 * reason for the split.
 */

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
