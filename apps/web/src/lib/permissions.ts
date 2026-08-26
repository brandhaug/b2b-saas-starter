import {
  authorize,
  memberPrincipal,
  type PermissionRequest
} from '@b2b-saas-starter/authz/client'
import { type WorkspaceViewer } from '@b2b-saas-starter/capabilities/src/governance/workspace-identity.ts'

/**
 * Client-side permission checks for workspace UI.
 *
 * The viewer's role arrives in the loader payload and the decision comes from
 * the same pure `authorize()` the server guard uses, through the package's
 * client entry point — so there is one role table and a component never
 * compares a role name (see `packages/authz/AGENTS.md` anti-patterns).
 *
 * This hides and disables; it does not enforce. The loader withholding the data
 * is the enforcement, and every mutation still goes through
 * `requireWorkspacePermission` on the server.
 */
export type Viewer = WorkspaceViewer | null

export function viewerCan(viewer: Viewer, permission: PermissionRequest): boolean {
  if (!viewer) return false
  return authorize(memberPrincipal(viewer.role), permission).success
}
