import { Context, type Effect } from 'effect'

import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type ResourceSelectionRejected } from './errors.ts'
import {
  type ResourceSelection,
  type EntitlementResource,
  type ResourceEntitlement
} from './plan-catalog.ts'
import { type WorkspaceContext } from './ports.ts'

export type ResourceEntitlementInput = {
  readonly resource: EntitlementResource
}

export type ResourceEntitlementsInterface = {
  readonly getSelection: () => Effect.Effect<
    ResourceSelection,
    CapabilityUnavailable,
    WorkspaceContext
  >
  readonly getSelectionForWorkspace: (
    workspaceId: string
  ) => Effect.Effect<ResourceSelection, CapabilityUnavailable>
  readonly select: (
    input: ResourceSelection
  ) => Effect.Effect<
    ResourceSelection,
    CapabilityUnavailable | ResourceSelectionRejected,
    WorkspaceContext
  >
  readonly summarize: (
    input: ResourceEntitlementInput
  ) => Effect.Effect<ResourceEntitlement, CapabilityUnavailable, WorkspaceContext>
  readonly isActiveForWorkspace: (
    input: { readonly workspaceId: string } & (
      | { readonly resource: 'api_token'; readonly resourceId: ApiTokenId }
      | {
          readonly resource: 'webhook_endpoint'
          readonly resourceId: WebhookEndpointId
        }
    )
  ) => Effect.Effect<boolean, CapabilityUnavailable>
}

export class ResourceEntitlements extends Context.Service<
  ResourceEntitlements,
  ResourceEntitlementsInterface
>()('@b2b-saas-starter/billing/ResourceEntitlements') {}
import { type ApiTokenId, type WebhookEndpointId } from '@b2b-saas-starter/db/ids'
