import { type Invitation } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { type WorkspaceExport } from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { type WorkspaceRole } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { type Badge } from '@/components/ui/badge'

export type BadgeVariant = NonNullable<React.ComponentProps<typeof Badge>['variant']>

/**
 * Workspace role → badge variant, the one mapping every surface that renders
 * a role uses (roster, `/admin`'s membership editor, invitation accept). A
 * role is identity, not a status: the status hues (ok/warn/info/destructive)
 * stay reserved for states, mauve stays reserved for emphasis, and the owner
 * — the one role a workspace cannot share, since only owners grant ownership
 * — is the one role that earns the emphasis hue. Admin and member are peers
 * in neutral.
 */
export function roleVariant(role: WorkspaceRole): BadgeVariant {
  if (role === 'owner') {
    return 'default'
  }
  return 'neutral'
}

/**
 * Status → badge variant, in one place. `pending` is the only state a
 * workspace can still act on, so it gets the attention hue (warn); settled
 * states go neutral; refusal stays destructive. One hue per state everywhere
 * — mauve (`default`) means current/selected, never a status.
 */
export function invitationStatusVariant(status: Invitation['status']): BadgeVariant {
  if (status === 'pending') {
    return 'warn'
  }
  if (status === 'accepted') {
    return 'neutral'
  }
  return 'outline'
}

// A fallback keeps unknown free-text statuses visible rather than crashing
// the render — the column is free-text by design.
export function webhookDeliveryStatusVariant(status: string): BadgeVariant {
  if (status === 'delivered') {
    return 'ok'
  }
  if (status === 'failed') {
    return 'destructive'
  }
  if (status === 'pending') {
    return 'warn'
  }
  return 'outline'
}

/** Export job status → badge variant: pending needs attention, ready is done, failed is destructive. */
export function workspaceExportStatusVariant(
  status: WorkspaceExport['status']
): BadgeVariant {
  if (status === 'pending') {
    return 'warn'
  }
  if (status === 'ready') {
    return 'ok'
  }
  return 'destructive'
}

/**
 * Audit actor type → badge variant. Like a role, an actor type is identity,
 * not a state — no status hue and no emphasis: a session user is the common
 * case in neutral, the platform acted alone in `info` (the informational
 * hue), and a machine credential takes the bordered `outline` pill, visible
 * without claiming a state. Unknown values (a row newer than the vocabulary)
 * fall back to `outline`, the badge vocabulary's home for exactly that.
 */
export function auditActorTypeVariant(actorType: string): BadgeVariant {
  if (actorType === 'user') {
    return 'neutral'
  }
  if (actorType === 'system') {
    return 'info'
  }
  return 'outline'
}
