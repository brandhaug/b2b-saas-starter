export type BadgeVariant = 'ok' | 'destructive' | 'warn' | 'outline'

/** Unknown delivery statuses remain visible with neutral emphasis. */
export function webhookDeliveryStatusVariant(status: string): BadgeVariant {
  if (status === 'delivered') {
    return 'ok'
  }
  if (
    status === 'failed' ||
    status === 'failed_permanent' ||
    status === 'dead_lettered'
  ) {
    return 'destructive'
  }
  if (status === 'pending') {
    return 'warn'
  }
  return 'outline'
}
