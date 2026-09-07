import * as m from '@b2b-saas-starter/i18n/messages'
import { DEFAULT_LOCALE, type Locale } from '@b2b-saas-starter/i18n/locale'
import { formatDateTime } from '@b2b-saas-starter/i18n/format'
import { Schema } from 'effect'

/**
 * Durable data for a system notification. The event name is stable while its
 * parameters carry the values that made that occurrence different. A null
 * event on a notification means its title and message are user authored.
 */
const WebhookPermanentEvent = Schema.Struct({
  type: Schema.Literal('webhook.permanent'),
  endpointUrl: Schema.String,
  eventType: Schema.String
})
const WebhookDeadLetterEvent = Schema.Struct({
  type: Schema.Literal('webhook.dead_letter'),
  endpointUrl: Schema.String,
  eventType: Schema.String,
  attempts: Schema.Number
})
const WebhookLadderThresholdEvent = Schema.Struct({
  type: Schema.Literal('webhook.ladder_threshold'),
  target: Schema.String,
  consecutiveFailures: Schema.Number
})
const WebhookLadderWarningEvent = Schema.Struct({
  type: Schema.Literal('webhook.ladder_warning'),
  target: Schema.String,
  consecutiveFailures: Schema.Number,
  disableAt: Schema.Number
})
const AccountImpersonatedEvent = Schema.Struct({
  type: Schema.Literal('account.impersonated'),
  adminName: Schema.String,
  minutes: Schema.Number
})
const WorkspaceExportReadyEvent = Schema.Struct({
  type: Schema.Literal('workspace.export_ready'),
  workspaceName: Schema.String,
  expiresAt: Schema.String
})
const BillingPlanChangedEvent = Schema.Struct({
  type: Schema.Literal('billing.plan_changed'),
  planName: Schema.String
})
const WorkspaceMemberJoinedEvent = Schema.Struct({
  type: Schema.Literal('workspace_member.joined'),
  memberName: Schema.String,
  workspaceName: Schema.String,
  role: Schema.String
})
const ApiTokenCreatedEvent = Schema.Struct({
  type: Schema.Literal('api_token.created'),
  actorName: Schema.String,
  tokenName: Schema.String,
  scopes: Schema.String
})
const SsoTestFailedEvent = Schema.Struct({
  type: Schema.Literal('sso.test_failed'),
  protocol: Schema.String,
  domain: Schema.String,
  reasonCode: Schema.String
})
const SsoDomainVerificationEvent = Schema.Struct({
  type: Schema.Literal('sso.domain_verification'),
  domain: Schema.String,
  status: Schema.Literals(['verified', 'grace', 'failed']),
  graceUntil: Schema.String
})
const SsoRecoveryEvent = Schema.Struct({
  type: Schema.Literal('sso.recovery'),
  exceptionId: Schema.String,
  action: Schema.Literals(['created', 'used', 'expired']),
  ownerUserId: Schema.String,
  expiresAt: Schema.String
})

/** Schema used at the JSON storage and HTTP boundary for durable events. */
export const NotificationEventSchema = Schema.Union([
  WebhookPermanentEvent,
  WebhookDeadLetterEvent,
  WebhookLadderThresholdEvent,
  WebhookLadderWarningEvent,
  AccountImpersonatedEvent,
  WorkspaceExportReadyEvent,
  BillingPlanChangedEvent,
  WorkspaceMemberJoinedEvent,
  ApiTokenCreatedEvent,
  SsoTestFailedEvent,
  SsoDomainVerificationEvent,
  SsoRecoveryEvent
])
export type SystemNotificationEvent = typeof NotificationEventSchema.Type
export type NotificationEvent = SystemNotificationEvent

export type RenderedNotificationEvent = {
  readonly title: string
  readonly message: string
}

export type NotificationCopyInput = {
  readonly title: string
  readonly message: string
  readonly event?: SystemNotificationEvent | undefined
}

/** Render stored user copy or the current localized copy for a system event. */
export function renderNotificationCopy(
  notification: NotificationCopyInput,
  locale: Locale = DEFAULT_LOCALE,
  timeZone = 'UTC'
): RenderedNotificationEvent {
  if (notification.event === undefined) {
    return { title: notification.title, message: notification.message }
  }
  return renderNotificationEvent(notification.event, locale, timeZone)
}

/** Render an event with the recipient's current locale, including old rows. */
export function renderNotificationEvent(
  event: SystemNotificationEvent,
  locale: Locale = DEFAULT_LOCALE,
  timeZone = 'UTC'
): RenderedNotificationEvent {
  const options = { locale }
  switch (event.type) {
    case 'webhook.permanent': {
      return {
        title: m.backend_email_notification_event_webhook_permanent_title({}, options),
        message: m.backend_email_notification_event_webhook_permanent_message(
          { endpointUrl: event.endpointUrl, eventType: event.eventType },
          options
        )
      }
    }
    case 'webhook.dead_letter': {
      return {
        title: m.backend_email_notification_event_webhook_dead_letter_title(
          {},
          options
        ),
        message: m.backend_email_notification_event_webhook_dead_letter_message(
          {
            endpointUrl: event.endpointUrl,
            eventType: event.eventType,
            attempts: event.attempts
          },
          options
        )
      }
    }
    case 'webhook.ladder_threshold': {
      return {
        title: m.backend_email_notification_event_webhook_ladder_threshold_title(
          {},
          options
        ),
        message: m.backend_email_notification_event_webhook_ladder_threshold_message(
          {
            target: event.target,
            consecutiveFailures: event.consecutiveFailures
          },
          options
        )
      }
    }
    case 'webhook.ladder_warning': {
      return {
        title: m.backend_email_notification_event_webhook_ladder_warning_title(
          {},
          options
        ),
        message: m.backend_email_notification_event_webhook_ladder_warning_message(
          {
            target: event.target,
            consecutiveFailures: event.consecutiveFailures,
            disableAt: event.disableAt
          },
          options
        )
      }
    }
    case 'account.impersonated': {
      return {
        title: m.backend_email_notification_event_impersonation_title({}, options),
        message: m.backend_email_notification_event_impersonation_message(
          { adminName: event.adminName, minutes: event.minutes },
          options
        )
      }
    }
    case 'workspace.export_ready': {
      return {
        title: m.backend_email_notification_event_export_ready_title({}, options),
        message: m.backend_email_notification_event_export_ready_message(
          {
            workspaceName: event.workspaceName,
            expiresAt: formatDateTime(
              event.expiresAt,
              locale,
              { dateStyle: 'medium', timeStyle: 'short' },
              timeZone
            )
          },
          options
        )
      }
    }
    case 'billing.plan_changed': {
      return {
        title: m.backend_email_notification_event_plan_changed_title(
          { planName: event.planName },
          options
        ),
        message: m.backend_email_notification_event_plan_changed_message(
          { planName: event.planName },
          options
        )
      }
    }
    case 'workspace_member.joined': {
      let role = event.role
      if (event.role === 'owner') {
        role = m.backend_email_notification_event_member_role_owner({}, options)
      } else if (event.role === 'admin') {
        role = m.backend_email_notification_event_member_role_admin({}, options)
      } else if (event.role === 'member') {
        role = m.backend_email_notification_event_member_role_member({}, options)
      }
      return {
        title: m.backend_email_notification_event_member_joined_title({}, options),
        message: m.backend_email_notification_event_member_joined_message(
          {
            memberName: event.memberName,
            workspaceName: event.workspaceName,
            role
          },
          options
        )
      }
    }
    case 'api_token.created': {
      return {
        title: m.backend_email_notification_event_token_created_title({}, options),
        message: m.backend_email_notification_event_token_created_message(
          {
            actorName: event.actorName,
            tokenName: event.tokenName,
            scopes: event.scopes
          },
          options
        )
      }
    }
    case 'sso.recovery': {
      let message = m.backend_email_sso_recovery_expired(
        { owner: event.ownerUserId },
        options
      )
      if (event.action === 'created') {
        message = m.backend_email_sso_recovery_created(
          { owner: event.ownerUserId, expiry: event.expiresAt },
          options
        )
      } else if (event.action === 'used') {
        message = m.backend_email_sso_recovery_used(
          { owner: event.ownerUserId, expiry: event.expiresAt },
          options
        )
      }
      return {
        title: m.backend_email_sso_recovery_title({}, options),
        message
      }
    }
    case 'sso.domain_verification': {
      let message = m.backend_email_sso_domain_grace(
        { domain: event.domain, deadline: event.graceUntil },
        options
      )
      if (event.status === 'verified') {
        message = m.backend_email_sso_domain_restored({ domain: event.domain }, options)
      } else if (event.status === 'failed') {
        message = m.backend_email_sso_domain_failed({ domain: event.domain }, options)
      }
      return {
        title: m.backend_email_sso_domain_title({}, options),
        message
      }
    }
    case 'sso.test_failed': {
      const reasonOptions = { locale }
      let reason = m.backend_email_notification_event_sso_reason_unknown(
        {},
        reasonOptions
      )
      switch (event.reasonCode) {
        case 'discovery_unreachable': {
          reason = m.backend_email_notification_event_sso_reason_discovery_unreachable(
            {},
            reasonOptions
          )
          break
        }
        case 'discovery_invalid': {
          reason = m.backend_email_notification_event_sso_reason_discovery_invalid(
            {},
            reasonOptions
          )
          break
        }
        case 'saml_metadata_invalid': {
          reason = m.backend_email_notification_event_sso_reason_saml_metadata_invalid(
            {},
            reasonOptions
          )
          break
        }
        case 'saml_metadata_missing_entry_point': {
          reason =
            m.backend_email_notification_event_sso_reason_saml_metadata_missing_entry_point(
              {},
              reasonOptions
            )
          break
        }
      }
      return {
        title: m.backend_email_notification_event_sso_failed_title({}, options),
        message: m.backend_email_notification_event_sso_failed_message(
          {
            protocol: event.protocol.toUpperCase(),
            domain: event.domain,
            reason
          },
          options
        )
      }
    }
  }
}
