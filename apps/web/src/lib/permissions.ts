import {
  authorize,
  memberPrincipal,
  type PermissionRequest
} from '@b2b-saas-starter/authz/client'
import { type WorkspaceRole } from '@b2b-saas-starter/capabilities/governance/workspace-identity'

// The UI's role/scope vocabularies, re-exported from the Schema-free enum
// leaf so components never import `@b2b-saas-starter/db` directly (the lint
// rule bans it from routes/components) and never touch the capability
// modules that own the `Schema.Literals` forms — those pin effect/Schema
// into the route tree the browser preloads.
export {
  apiTokenScopes as API_TOKEN_SCOPES,
  workspaceRoles as WORKSPACE_ROLES
} from '@b2b-saas-starter/db/enums'

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
/**
 * The resolved viewer shape loaders hand to permission checks and UI: only the
 * workspace role. A web payload type, not a capability one — nothing inside
 * `@b2b-saas-starter/capabilities` reads it.
 */
export type WorkspaceViewer = { readonly role: WorkspaceRole }

export type Viewer = WorkspaceViewer | null

export function viewerCan(viewer: Viewer, permission: PermissionRequest): boolean {
  if (!viewer) {
    return false
  }
  return authorize(memberPrincipal(viewer.role), permission).success
}
