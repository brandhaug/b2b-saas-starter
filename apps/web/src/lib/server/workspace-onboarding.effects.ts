import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { WorkspaceOnboarding } from '@b2b-saas-starter/capabilities/governance/workspace-onboarding'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { Effect, type Scope } from 'effect'

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

/**
 * The effect below the session gate: proves the actor may dismiss
 * (`onboarding:dismiss` — owner and admin, never member), then hands the
 * mutation to the capability. Exported so the permission test drives it
 * against fixture layers without a request or an auth runtime. Resolves
 * `false` when the workspace had already dismissed — no second audit row.
 */
export function dismissOnboardingChecklist(): Effect.Effect<
  boolean,
  AuthorizationDenied | CapabilityUnavailable,
  Scope.Scope | WorkspaceContext | WorkspaceOnboarding
> {
  return Effect.gen(function* () {
    yield* requireWorkspacePermission({ onboarding: ['dismiss'] })
    const onboarding = yield* WorkspaceOnboarding
    return yield* onboarding.dismiss
  })
}

export async function dismissOnboardingChecklistHandler(
  input: DismissInput
): Promise<boolean> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(input.workspaceSlug, dismissOnboardingChecklist(), {
    userId: session.user.id
  })
}
