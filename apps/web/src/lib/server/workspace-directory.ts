import { createServerFn } from '@tanstack/react-start'

import { type WorkspaceDirectory } from '../workspace-directory'

export const loadWorkspaceDirectoryServerFn = createServerFn({
  method: 'GET'
}).handler(async (): Promise<WorkspaceDirectory> => {
  const { loadWorkspaceDirectoryHandler } =
    await import('./workspace-directory.effects')
  return loadWorkspaceDirectoryHandler()
})
