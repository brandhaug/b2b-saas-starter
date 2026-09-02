/**
 * The client-safe half of this package.
 *
 * `authorize()` is pure — no Effect, no context, no I/O — so the same decision
 * that gates a request can decide whether a control renders. This entry point
 * exists so a browser bundle can reach it without pulling in `guard.ts`, which
 * imports `effect` and the logger for the wide-event annotation on denial.
 *
 * Import it as `@b2b-saas-starter/authz/client` from anything that ships to the
 * browser. It is also the only entry point for the role and scope vocabulary:
 * `./guard` adds the Effect-side gate on top, and `./errors` the denial. There
 * is no root entry point.
 */
export {
  authorize,
  memberPrincipal,
  tokenPrincipal,
  type PermissionRequest,
  type Principal
} from './principal.ts'
export {
  apiTokenScopeAccess,
  workspaceRoleAccess,
  type ApiTokenScope,
  type StarterRole,
  type WorkspaceRole
} from './roles.ts'
export {
  accessControl,
  starterResources,
  starterStatements,
  type StarterStatements
} from './statements.ts'
