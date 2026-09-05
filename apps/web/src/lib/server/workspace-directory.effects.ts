import { listWorkspacesForUser } from '@b2b-saas-starter/capabilities/workspace-projections'

import { runCapabilities } from '../capabilities'
import { type WorkspaceDirectory } from '../workspace-directory'
import { requireRequestSession } from './auth'

/**
 * The workspace-directory read — the behaviour behind
 * `loadWorkspaceDirectoryServerFn` (`workspace-directory.ts`). Everything
 * imported at this module's top level (the `listWorkspacesForUser`
 * projection, the Effect runtime it rides) must never reach the browser
 * bundle, which is why the route tree reaches this file only through dynamic
 * `import()` inside the server fn's handler (see `invitations.ts` for the
 * reference split).
 */

/**
 * The directory as a plain function, so tests drive it directly with fixture
 * users against the Seed layer — no request, no auth runtime. Possibly empty:
 * a user with no memberships gets `[]`, not an error (the projection's own
 * contract).
 */
export function loadWorkspaceDirectory(input: {
  readonly userId: string
}): Promise<WorkspaceDirectory> {
  return runCapabilities(listWorkspacesForUser(input.userId))
}

/**
 * The handler the server fn delegates to: the layout route's `requireSession`
 * gate has already proved somebody is signed in; this re-proves it
 * server-side and keys the read off the session, never off the request.
 */
export async function loadWorkspaceDirectoryHandler(): Promise<WorkspaceDirectory> {
  const session = await requireRequestSession()
  return loadWorkspaceDirectory({ userId: session.user.id })
}
