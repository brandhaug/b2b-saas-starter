import { createServerFn } from '@tanstack/react-start'

import { type WorkspaceDirectory } from '../workspace-directory'

/**
 * The workspace-directory loader, in a **client-safe** module.
 *
 * The `/workspaces` layout route statically imports this file, and the route
 * tree ships to the browser — so everything at this module's top level rides
 * on every page. That is why the `listWorkspacesForUser` projection and its
 * Effect wiring live in `workspace-directory.effects.ts` and are reached only
 * through dynamic `import()` inside the handler: TanStack Start strips
 * handler bodies from the client build, so the capabilities graph never
 * ships, while the directory type still does.
 */
export const loadWorkspaceDirectoryServerFn = createServerFn({
  method: 'GET'
}).handler(async (): Promise<WorkspaceDirectory> => {
  const { loadWorkspaceDirectoryHandler } =
    await import('./workspace-directory.effects')
  return loadWorkspaceDirectoryHandler()
})
