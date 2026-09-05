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
