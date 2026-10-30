import { HttpApiSchema } from 'effect/http-api'
import { LoadWorkspaceMembersSchema } from './membership-records'
import { ChangeUserWorkspaceRoleSchema } from './administration-records'

export const loadWorkspaceMembersServerFnResponse = LoadWorkspaceMembersSchema
export const changeMemberRoleServerFnResponse = ChangeUserWorkspaceRoleSchema
export const removeMemberServerFnResponse = HttpApiSchema.NoContent
export const leaveWorkspaceServerFnResponse = HttpApiSchema.NoContent
