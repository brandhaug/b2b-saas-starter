import { createContext, useContext } from 'react'
import { type WorkspaceListItemProjection } from '@b2b-saas-starter/capabilities/workspace-projections'

/**
 * The signed-in user's workspaces, as the `listWorkspacesForUser` projection
 * returns them. The `/workspaces` layout route loads it once (its loader) and
 * publishes it here, so the sidebar switcher and the user menu read the same
 * directory on every workspace page without each page threading it through
 * props. `null` outside the subtree (e.g. /admin, /account) — no switcher
 * menu renders there.
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

/**
 * The workspace the sidebar anchors to: a slug plus the display name to show
 * for it. The workspace shell remembers the last one the user visited in this
 * shape, so surfaces without a workspace of their own (/account, /admin, the
 * picker) can keep the full sidebar instead of emptying the column.
 */
export type SidebarWorkspace = {
  readonly slug: string
  readonly name: string
}

/**
 * The last workspace the user visited, from the router context the shell
 * writes it to. The parameter is structural — `{ options: { context } }` —
 * so the registered router satisfies it with its `RouterAppContext` typing
 * (the field is declared there) and no assertion is needed; test harness
 * routers, whose context is an untyped record, still fit the shape at the
 * call sites they drive through components.
 */
export function lastVisitedWorkspace(router: {
  readonly options: { readonly context: RouterContextWithLastWorkspace }
}): SidebarWorkspace | null {
  return router.options.context.lastWorkspace ?? null
}

/** The router context slice the remembered workspace lives in. */
type RouterContextWithLastWorkspace = {
  readonly lastWorkspace?: SidebarWorkspace | null
}

/**
 * Remember `workspace` as the last one visited (`null` to forget — the
 * sign-out flow does, so the memory never outlives the session that earned
 * it), preserving every other field of the router context (`update` replaces
 * the object rather than merging).
 */
export function rememberWorkspace(
  router: {
    readonly options: { readonly context: RouterContextWithLastWorkspace }
    update(options: { context: RouterContextWithLastWorkspace }): void
  },
  workspace: SidebarWorkspace | null
): void {
  router.update({
    context: {
      ...router.options.context,
      lastWorkspace: workspace
    }
  })
}
