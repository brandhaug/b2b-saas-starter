import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

import { type ApiToken } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { type SsoConnection } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { type WorkspaceViewer } from '@/lib/permissions'
import { type WorkspaceSuspension } from '@b2b-saas-starter/capabilities/governance/workspace-suspension'

const WorkspaceSlugInput = Schema.Struct({ workspaceSlug: Schema.NonEmptyString })
type WorkspaceSuspensionPayload = Pick<
  WorkspaceSuspension,
  'workspaceId' | 'status' | 'customerExplanation' | 'changedAt'
>

export type WorkspaceSuspensionGatePayload = WorkspaceSuspensionPayload & {
  readonly workspaceName: string
  readonly viewer: WorkspaceViewer
}

export type WorkspaceRecoveryPayload = WorkspaceSuspensionGatePayload & {
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
