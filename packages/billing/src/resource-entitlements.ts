import { Context, type Effect } from 'effect'

import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type ResourceSelectionRejected } from './errors.ts'
import {
  ResourceSelection,
  type EntitlementResource,
  type ResourceEntitlementSummary
} from './plan-catalog.ts'
import { type WorkspaceContext } from './ports.ts'

export const ResourceSelectionInput = ResourceSelection
export type ResourceSelectionInput = typeof ResourceSelectionInput.Type

export type ResourceEntitlementInput = {
  readonly resource: EntitlementResource
}

export type ResourceEntitlementsInterface = {
  readonly getSelection: () => Effect.Effect<
    ResourceSelectionInput,
    CapabilityUnavailable,
    WorkspaceContext
  >
  readonly getSelectionForWorkspace: (
    workspaceId: string
  ) => Effect.Effect<ResourceSelectionInput, CapabilityUnavailable>
  readonly select: (
    input: ResourceSelectionInput
  ) => Effect.Effect<
    ResourceSelectionInput,
    CapabilityUnavailable | ResourceSelectionRejected,
    WorkspaceContext
  >
  readonly summarize: (
    input: ResourceEntitlementInput
  ) => Effect.Effect<
    ResourceEntitlementSummary,
    CapabilityUnavailable,
    WorkspaceContext
  >
  readonly isActive: (
    input: ResourceEntitlementInput & { readonly resourceId: string }
  ) => Effect.Effect<boolean, CapabilityUnavailable, WorkspaceContext>
  readonly isActiveForWorkspace: (
    input: ResourceEntitlementInput & {
      readonly resourceId: string
      readonly workspaceId: string
    }
  ) => Effect.Effect<boolean, CapabilityUnavailable>
}

export class ResourceEntitlements extends Context.Service<
  ResourceEntitlements,
  ResourceEntitlementsInterface
>()('@b2b-saas-starter/billing/ResourceEntitlements') {}
