import { Effect } from 'effect'
import { type NotifyWorkspaceOwnersInput } from '../notifications/notification-feed.ts'
import {
  renderNotificationEvent,
  type NotificationEvent
} from '../notifications/notification-events.ts'
import {
  WorkspaceSuspensionUnauthorized,
  type WorkspaceSuspension,
  type WorkspaceSuspensionTransitionInput
} from './workspace-suspension.ts'

export function validateSuspensionTransition(
  input: WorkspaceSuspensionTransitionInput
) {
  const internalReason = input.internalReason?.trim() ?? ''
  const customerExplanation = input.customerExplanation?.trim() ?? ''
  if (
    (input.actor.impersonatedBy !== null && input.actor.impersonatedBy !== undefined) ||
    internalReason.length === 0 ||
    (input.action === 'suspend' && customerExplanation.length === 0)
  ) {
    return Effect.fail(new WorkspaceSuspensionUnauthorized())
  }
  return Effect.succeed({ internalReason, customerExplanation })
}

export function suspensionNotice(
  state: WorkspaceSuspension,
  transitionId: string
): NotifyWorkspaceOwnersInput {
  const event = {
    type: 'workspace.suspension_changed',
    status: state.status,
    customerExplanation: state.customerExplanation
  } satisfies NotificationEvent
  return {
    workspaceId: state.workspaceId,
    audience: 'owners_and_admins',
    deduplicationKey: `workspace-suspension:${transitionId}`,
    kind: 'announcement',
    ...renderNotificationEvent(event),
    event
  }
}
