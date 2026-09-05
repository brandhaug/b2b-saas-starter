import {
  type CreatedWorkspace,
  WorkspaceLifecycle
} from '@b2b-saas-starter/capabilities/governance/workspace-lifecycle'
import { type Workspace } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { requireEmailVerification } from '@b2b-saas-starter/env/server'
import { env } from 'cloudflare:workers'
import { Effect } from 'effect'

import { runCapabilities, runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { webWorkspaceLifecycleBinding } from './workspace-binding'
import {
  type CreateWorkspaceInput,
  type DeleteWorkspaceInput,
  type RenameWorkspaceInput
} from './workspace-lifecycle'

/**
 * The workspace lifecycle effects and their server-only wiring, reached only
 * through dynamic `import()` inside the handlers of the server functions in
 * `workspace-lifecycle.ts`: handler bodies are stripped from the client
 * build, so this graph ships to the server alone. `workspace-lifecycle.ts`
 * holds the client-safe half and the reason for the split.
 */

/**
 * Typed failure for the creation gate below. Same shape and reason as
 * `UnauthorizedError`: server functions serialize thrown errors with
 * `name`/`message` intact, and the calling form shows `message`.
 */
export class UnverifiedEmailError extends Error {
  constructor() {
    super('Verify your email address before creating a workspace.')
    this.name = 'UnverifiedEmailError'
  }
}

/**
 * The creation gate's refusal decision, in one place so the branch the tests
 * drive is the branch a request takes (the same rule `enforceRequiredEnvAudit`
 * follows). It states exactly what the plugin's
 * `allowUserToCreateOrganization` callback states: when verification is
 * enforced, an unverified mailbox does not get to mint workspaces.
 */
export function unverifiedCreatorRefused(input: {
  readonly emailVerified: boolean
  readonly environment: string | undefined
}): boolean {
  return requireEmailVerification(input.environment) && !input.emailVerified
}

export async function createWorkspaceHandler(
  input: CreateWorkspaceInput
): Promise<CreatedWorkspace> {
  // Creating is not a workspace-scoped call: there is no workspace to resolve,
  // so this runs through `runCapabilities` with no `WorkspaceContext`. The
  // plugin itself makes the creator its first owner.
  const session = await requireRequestSession()
  // The email-verification gate the plugin config promises has to run here:
  // `createOrganization` is a headerless server-only endpoint, so Better
  // Auth treats this app's own call as a system action and never invokes
  // `allowUserToCreateOrganization` — the same headerless-trust seam #242
  // closed for identity. The session is the identity source for both halves
  // of the decision; `requireEmailVerification` derives the stance from
  // `ENVIRONMENT` exactly as `auth-runtime.ts` feeds the plugin config, so
  // the two gates cannot drift (local dev stays open, per the
  // provider-light rule).
  if (
    unverifiedCreatorRefused({
      emailVerified: session.user.emailVerified,
      environment: env.ENVIRONMENT
    })
  ) {
    // oxlint-disable-next-line effect/noThrowStatement -- TanStack Start serializes a thrown server-fn error back to the caller; the returned Promise has no error channel
    throw new UnverifiedEmailError()
  }
  return runCapabilities(
    Effect.gen(function* () {
      const lifecycle = yield* WorkspaceLifecycle
      return yield* lifecycle.create({
        name: input.name,
        slug: input.slug,
        // The acting user comes from the session, never the request body —
        // `createOrganization` is a trusted headerless endpoint.
        userId: session.user.id
      })
    }),
    { lifecycleBinding: webWorkspaceLifecycleBinding }
  )
}

// Rename and delete ARE workspace-scoped: the settings route resolves the
// workspace and the permission gates prove the actor may touch it.

export async function renameWorkspaceHandler(
  input: RenameWorkspaceInput
): Promise<Workspace> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ organization: ['update'] })
      const lifecycle = yield* WorkspaceLifecycle
      return yield* lifecycle.rename({ name: input.name })
    }),
    { userId: session.user.id },
    { lifecycleBinding: webWorkspaceLifecycleBinding }
  )
}

export async function deleteWorkspaceHandler(
  input: DeleteWorkspaceInput
): Promise<void> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ organization: ['delete'] })
      const lifecycle = yield* WorkspaceLifecycle
      yield* lifecycle.remove
    }),
    { userId: session.user.id },
    { lifecycleBinding: webWorkspaceLifecycleBinding }
  )
}
