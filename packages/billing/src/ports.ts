import { type AuditActorTypeValue } from '@b2b-saas-starter/db/enums'
import { type JsonObject } from '@b2b-saas-starter/db/schema'
import { type BatchStatement } from '@b2b-saas-starter/db/service'
import { Context, type Effect } from 'effect'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'

export type BillingWorkspace = { readonly id: string; readonly planId: string }
export type BillingActor = { readonly userId: string } | null
export type BillingWorkspaceContext = {
  readonly workspace: BillingWorkspace
  readonly actor: BillingActor
  readonly actorType: AuditActorTypeValue
}
export class WorkspaceContext extends Context.Service<
  WorkspaceContext,
  BillingWorkspaceContext
>()('@b2b-saas-starter/billing/WorkspaceContext') {}

export type AuditRecordInput = {
  readonly workspaceId?: string | null
  readonly actorUserId?: string | null
  readonly actorType: AuditActorTypeValue
  readonly eventType:
    | 'billing.checkout_started'
    | 'billing.plan_changed'
    | 'billing.portal_opened'
    | 'billing.resource_selection_updated'
    | 'billing.seats_changed'
    | 'billing.payment_failed'
    | 'billing.grace_expiring'
    | 'billing.payment_recovered'
  readonly targetType: 'workspace'
  readonly targetId?: string | null
  readonly metadata?: JsonObject
}
export type AuditPort = {
  readonly record: (
    input: AuditRecordInput
  ) => Effect.Effect<void, CapabilityUnavailable>
  readonly prepareRecord: (
    input: AuditRecordInput
  ) => Effect.Effect<BatchStatement, CapabilityUnavailable>
}
export class AuditEventLog extends Context.Service<AuditEventLog, AuditPort>()(
  '@b2b-saas-starter/billing/AuditEventLog'
) {}

export type NotificationPort = {
  readonly create: (input: {
    readonly deduplicationKey?: string
    readonly workspaceId: string
    readonly userId?: string | null
    readonly kind: 'billing.plan_changed'
    readonly title: string
    readonly message: string
  }) => Effect.Effect<unknown, CapabilityUnavailable>
}
export class NotificationFeed extends Context.Service<
  NotificationFeed,
  NotificationPort
>()('@b2b-saas-starter/billing/NotificationFeed') {}

export type BillingMember = { readonly id: string; readonly role: string }
