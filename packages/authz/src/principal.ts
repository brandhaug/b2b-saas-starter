import {
  type AuthorizeResponse,
  type RoleAuthorizeRequest
} from 'better-auth/plugins/access'
import {
  apiTokenScopeAccess,
  workspaceRoleAccess,
  type ApiTokenScope,
  type WorkspaceRole
} from './roles.ts'
import { type StarterStatements } from './statements.ts'

/**
 * The pure half of the guard: who is asking, what they are asking for, and the
 * decision. No Effect, no context, no I/O — so the matrix can be tested
 * directly and the same function can answer a UI question ("may this actor see
 * the button?") as well as a route question.
 */

/** What is being asked for, e.g. `{ apiToken: ['create'] }`. */
export type PermissionRequest = RoleAuthorizeRequest<StarterStatements>

/**
 * The actor's authorization identity, independent of how it authenticated. A
 * session resolves to a workspace role; a bearer token resolves to its scopes.
 */
export type Principal =
  | { readonly kind: 'member'; readonly role: WorkspaceRole }
  | { readonly kind: 'token'; readonly scopes: readonly ApiTokenScope[] }

export function memberPrincipal(role: WorkspaceRole): Principal {
  return { kind: 'member', role }
}

export function tokenPrincipal(scopes: readonly ApiTokenScope[]): Principal {
  return { kind: 'token', scopes }
}

/**
 * Decides one permission request. A token holding several scopes is granted
 * when any single scope covers the request — scopes add up, they do not
 * intersect. A token holding no scopes is denied, as is any request the role
 * does not cover.
 */
export function authorize(
  principal: Principal,
  request: PermissionRequest
): AuthorizeResponse {
  if (principal.kind === 'member') {
    return workspaceRoleAccess[principal.role].authorize(request)
  }
  let denial = 'no token scope grants this permission'
  for (const scope of principal.scopes) {
    const response = apiTokenScopeAccess[scope].authorize(request)
    if (response.success) return response
    denial = response.error
  }
  return { success: false, error: denial }
}
