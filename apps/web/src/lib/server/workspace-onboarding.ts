import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { WorkspaceOnboarding } from '@b2b-saas-starter/capabilities/governance/workspace-onboarding'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Schema, type Scope } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'

// All input constraints live in the schema — no imperative re-validation.
const DismissInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

const decodeDismissInput = Schema.decodeUnknownSync(DismissInput)

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

export const dismissOnboardingChecklistServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeDismissInput(input))
  .handler(async ({ data }): Promise<boolean> => {
    const session = await requireRequestSession()
    return runWorkspaceCapabilities(data.workspaceSlug, dismissOnboardingChecklist(), {
      userId: session.user.id
    })
  })
