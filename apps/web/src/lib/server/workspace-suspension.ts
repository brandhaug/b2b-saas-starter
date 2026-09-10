import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

import { type ApiToken } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { type SsoConnection } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { type WorkspaceViewer } from '@/lib/permissions'
import { type WorkspaceSuspension } from '@b2b-saas-starter/capabilities/governance/workspace-suspension'

const WorkspaceSlugInput = Schema.Struct({ workspaceSlug: Schema.NonEmptyString })
export type WorkspaceSuspensionPayload = Pick<
  WorkspaceSuspension,
  'workspaceId' | 'status' | 'customerExplanation' | 'changedAt'
>

/** The workspace identity every suspension read carries. */
type WorkspaceSuspensionIdentity = WorkspaceSuspensionPayload & {
  readonly workspaceName: string
  readonly viewer: WorkspaceViewer
}

export type WorkspaceSuspensionGatePayload = WorkspaceSuspensionIdentity & {
  /**
   * Whether this session still owes privileged-authentication proof for this
   * workspace. The gate read reports it instead of failing on it, so the
   * subtree's `beforeLoad` can send the actor to /verify-authentication as a
   * redirect — a page load, not an error boundary. It rides this payload
   * rather than a second server fn because the gate already resolves the
   * actor and the workspace on the same request.
   */
  readonly strongAuthenticationRequired: boolean
}

export type WorkspaceRecoveryPayload = WorkspaceSuspensionIdentity & {
  readonly canViewExplanation: boolean
  readonly canManageBilling: boolean
  readonly billingConfigured: boolean
  readonly apiTokens: ReadonlyArray<ApiToken> | null
  readonly ssoConnections: ReadonlyArray<SsoConnection> | null
}

export const loadWorkspaceSuspensionServerFn = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(WorkspaceSlugInput))
  .handler(async ({ data }): Promise<WorkspaceSuspensionGatePayload> => {
    const { loadWorkspaceSuspensionHandler } =
      await import('./workspace-suspension.effects')
    return loadWorkspaceSuspensionHandler(data)
  })

export const loadWorkspaceRecoveryServerFn = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(WorkspaceSlugInput))
  .handler(async ({ data }): Promise<WorkspaceRecoveryPayload> => {
    const { loadWorkspaceRecoveryHandler } =
      await import('./workspace-suspension.effects')
    return loadWorkspaceRecoveryHandler(data)
  })
