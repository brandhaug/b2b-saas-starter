import {
  type CreatedWorkspace,
  WorkspaceLifecycle
} from '@b2b-saas-starter/capabilities/governance/workspace-lifecycle'
import { type Workspace } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { requireEmailVerification } from '@b2b-saas-starter/env/server'
import { env } from 'cloudflare:workers'
import { Effect, Schema } from 'effect'

import { runCapabilities, runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { webWorkspaceLifecycleBinding } from './workspace-binding'

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

// All input constraints live in the schema — no imperative re-validation. The
// slug rule is lowercase letters, digits, and inner hyphens; the plugin
// enforces uniqueness on top of it.
const WORKSPACE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/
const CreateWorkspaceInput = Schema.Struct({
  name: Schema.NonEmptyString.check(Schema.isMaxLength(80)),
  slug: Schema.NonEmptyString.check(Schema.isPattern(WORKSPACE_SLUG_PATTERN)).check(
    Schema.isMinLength(3)
  )
})

const decodeCreateInput = Schema.decodeUnknownSync(CreateWorkspaceInput)

export async function createWorkspaceHandler(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
  data: unknown
): Promise<CreatedWorkspace> {
  const input = decodeCreateInput(data)
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

const RenameWorkspaceInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  name: Schema.NonEmptyString.check(Schema.isMaxLength(80))
})

const decodeRenameInput = Schema.decodeUnknownSync(RenameWorkspaceInput)

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
export async function renameWorkspaceHandler(data: unknown): Promise<Workspace> {
  const input = decodeRenameInput(data)
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

const DeleteWorkspaceInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

const decodeDeleteInput = Schema.decodeUnknownSync(DeleteWorkspaceInput)

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
export async function deleteWorkspaceHandler(data: unknown): Promise<void> {
  const input = decodeDeleteInput(data)
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
