import { type Invitation } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { type Badge } from '@/components/ui/badge'

export type BadgeVariant = NonNullable<React.ComponentProps<typeof Badge>['variant']>

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
