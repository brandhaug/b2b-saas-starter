import { type AuditActorTypeValue } from '@b2b-saas-starter/db/enums'
import { type JsonObject } from '@b2b-saas-starter/db/schema/json'
import { type BatchStatement } from '@b2b-saas-starter/db/service'
import { Context, type Effect } from 'effect'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'

export type BillingWorkspace = { readonly id: string; readonly planId: string }
/**
 * The resolved request context. A user provenance always carries its user and
 * a token or platform caller never claims one, so an audit row cannot record
 * `user` without an `actorUserId`.
 */
export type BillingWorkspaceContext =
  | {
      readonly workspace: BillingWorkspace
      readonly actorType: 'user'
      readonly actor: { readonly userId: string }
    }
  | {
      readonly workspace: BillingWorkspace
      readonly actorType: Exclude<AuditActorTypeValue, 'user'>
      readonly actor: null
    }
export class WorkspaceContext extends Context.Service<
  WorkspaceContext,
  BillingWorkspaceContext
>()('@b2b-saas-starter/billing/WorkspaceContext') {}

/** The attribution columns every workspace-scoped audit row carries. */
export type AuditAttribution = {
  readonly workspaceId: string
  readonly actorUserId: string | null
  readonly actorType: AuditActorTypeValue
}

/**
 * Derives an audit row's attribution from the request context: its workspace,
 * the resolved user (if any) and the caller's provenance. The one owner for
 * both packages, since this module is the request-context contract and the
 * capabilities `WorkspaceContext` satisfies it structurally; a new attribution
 * column changes this function, not every audited write.
 */
export function workspaceAuditAttribution(
  ctx: BillingWorkspaceContext
): AuditAttribution {
  return {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.actor?.userId ?? null,
    actorType: ctx.actorType
  }
}

/** Billing audits are always workspace-scoped, so they carry the full attribution. */
export type AuditRecordInput = AuditAttribution & {
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

export type BillingWebhookPublisherPort = {
  readonly publishPlanChanged: (input: {
    readonly workspaceId: string
    readonly planId: string
    readonly previousPlanId: string | null
  }) => Effect.Effect<void, never>
}
export class BillingWebhookPublisher extends Context.Service<
  BillingWebhookPublisher,
  BillingWebhookPublisherPort
>()('@b2b-saas-starter/billing/WebhookPublisher') {}

export type BillingMember = { readonly id: string; readonly role: string }
