export { AuthorizationDenied } from './errors.ts'
export { requirePermission } from './guard.ts'
export {
  authorize,
  memberPrincipal,
  tokenPrincipal,
  type PermissionRequest,
  type Principal
} from './principal.ts'
export {
  adminRole,
  adminScopeRole,
  apiTokenScopeAccess,
  memberRole,
  ownerRole,
  readScopeRole,
  workspaceRoleAccess,
  writeScopeRole,
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
