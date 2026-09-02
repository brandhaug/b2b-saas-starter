import { createContext, useContext } from 'react'
import { type WorkspaceListItemProjection } from '@b2b-saas-starter/capabilities/workspace-projections'

/**
 * The signed-in user's workspaces, as the `listWorkspacesForUser` projection
 * returns them. The `/workspaces` layout route loads it once (its loader) and
 * publishes it here, so the sidebar switcher and the user menu read the same
 * directory on every workspace page without each page threading it through
 * props. `null` outside the subtree (e.g. /admin, /account) — no switcher
 * renders there.
 */
export type WorkspaceDirectory = ReadonlyArray<WorkspaceListItemProjection>

export const WorkspaceDirectoryContext = createContext<WorkspaceDirectory | null>(null)

export function useWorkspaceDirectory(): WorkspaceDirectory | null {
  return useContext(WorkspaceDirectoryContext)
}

/**
 * The workspace named by `workspaceSlug`, or `undefined` when the directory
 * does not carry it (another actor's session, or a stale slug).
 */
export function findWorkspace(
  directory: WorkspaceDirectory | null,
  workspaceSlug: string
): WorkspaceListItemProjection['workspace'] | undefined {
  return directory?.find((entry) => entry.workspace.slug === workspaceSlug)?.workspace
}
