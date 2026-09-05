import { createServerFn } from '@tanstack/react-start'

import { type WorkspaceDirectory } from '../workspace-directory'

/**
 * The workspace-directory loader, in a **client-safe** module: the
 * client-safe half of the `workspace-directory.effects.ts` split (see
 * apps/web/AGENTS.md for the rule and `assert-client-boundary.mjs` for the
 * enforcement). The directory type still ships with this half; the
 * `listWorkspacesForUser` projection and its Effect wiring stay in the
 * effects half.
 */
export const loadWorkspaceDirectoryServerFn = createServerFn({
  method: 'GET'
}).handler(async (): Promise<WorkspaceDirectory> => {
  const { loadWorkspaceDirectoryHandler } =
    await import('./workspace-directory.effects')
  return loadWorkspaceDirectoryHandler()
})
