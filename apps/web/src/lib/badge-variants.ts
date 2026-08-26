import { type Invitation } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { type Badge } from '@/components/ui/badge'

export type BadgeVariant = NonNullable<React.ComponentProps<typeof Badge>['variant']>

/** `pending` is the only status a workspace can still act on, so it leads. */
export function invitationStatusVariant(status: Invitation['status']): BadgeVariant {
  if (status === 'pending') return 'default'
  if (status === 'accepted') return 'secondary'
  return 'outline'
}

// A fallback keeps unknown free-text statuses visible rather than crashing
// the render — the column is free-text by design.
export function webhookDeliveryStatusVariant(status: string): BadgeVariant {
  if (status === 'delivered') return 'default'
  if (status === 'failed') return 'destructive'
  return 'outline'
}
