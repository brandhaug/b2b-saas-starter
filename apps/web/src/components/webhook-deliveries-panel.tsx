import { useState } from 'react'
import { type WebhookDelivery } from '@b2b-saas-starter/capabilities/src/developer-platform/webhook-endpoints.ts'
import { Cause, Effect, Exit, Option } from 'effect'
import { causeMessage } from '@/lib/cause-message'
import { redeliverWebhookServerFn } from '@/lib/server/webhook-redelivery'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const RETRY_FAILED = 'Retry failed. Try again.'
const NOT_REDELIVERABLE = 'That delivery can no longer be redelivered.'

/**
 * The one server call each retry button makes, as a port. Injected rather than
 * imported at the call site so a test drives the panel with a real function of
 * this shape instead of replacing the module it lives in.
 */
export type RedeliverWebhook = (input: {
  readonly data: { readonly workspaceSlug: string; readonly deliveryId: string }
}) => Promise<boolean>

/** Only these terminal statuses leave the queue's hands for good. */
function isRedeliverable(status: string): boolean {
  return status === 'failed_permanent' || status === 'dead_lettered'
}

/** Badge copy per delivery status, falling back to the raw value. */
type StatusBadge = {
  label: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
}

function statusBadge(status: string): StatusBadge {
  if (status === 'delivered') {
    return { label: 'Delivered', variant: 'secondary' }
  }
  // Retryable: the queue still owns this message.
  if (status === 'failed') {
    return { label: 'Retrying', variant: 'outline' }
  }
  if (status === 'failed_permanent') {
    return { label: 'Failed', variant: 'destructive' }
  }
  if (status === 'dead_lettered') {
    return { label: 'Dead-lettered', variant: 'destructive' }
  }
  return { label: status, variant: 'outline' }
}

/**
 * Recent webhook deliveries for the workspace dashboard, newest first. Rows
 * that reached a terminal state offer a retry button, which re-enqueues the
 * original payload through `redeliverWebhookDelivery`; the queue consumer then
 * dispatches it like any other message and appends a new attempt row.
 */
export function WebhookDeliveriesPanel({
  workspaceSlug,
  deliveries,
  ports
}: {
  readonly workspaceSlug: string
  readonly deliveries: readonly WebhookDelivery[]
  readonly ports?: { readonly redeliver?: RedeliverWebhook | undefined }
}) {
  const redeliver = ports?.redeliver ?? redeliverWebhookServerFn
  // One in-flight retry at a time keeps the pending state readable; a second
  // click on another row can wait a beat.
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [redeliveredId, setRedeliveredId] = useState<string | null>(null)
  const retryPending = pendingId !== null

  async function retry(deliveryId: string) {
    setRetryError(null)
    setRedeliveredId(null)
    setPendingId(deliveryId)
    const exit = await Effect.runPromiseExit(
      Effect.tryPromise({
        try: () => redeliver({ data: { workspaceSlug, deliveryId } }),
        catch: (error) => causeMessage(error, RETRY_FAILED)
      })
    ).finally(() => setPendingId(null))
    if (Exit.isFailure(exit)) {
      setRetryError(
        Option.getOrElse(Cause.findErrorOption(exit.cause), () => RETRY_FAILED)
      )
      return
    }
    if (exit.value) {
      setRedeliveredId(deliveryId)
    } else {
      setRetryError(NOT_REDELIVERABLE)
    }
  }

  return (
    <div className="grid gap-3" aria-label="Recent webhook deliveries">
      <p className="text-sm font-medium">Recent deliveries</p>
      {retryError ? (
        <p className="text-xs text-destructive" role="alert">
          {retryError}
        </p>
      ) : null}
      {deliveries.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-center">
          <p className="text-sm text-muted-foreground">No deliveries recorded yet.</p>
        </div>
      ) : (
        <ul className="grid gap-2">
          {deliveries.map((delivery) => (
            <li
              key={delivery.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm">{delivery.eventType}</p>
                <p className="text-xs text-muted-foreground">
                  {delivery.lastAttemptAt ?? '—'}
                  {delivery.responseStatus === null
                    ? ''
                    : ` · HTTP ${delivery.responseStatus}`}
                  {` · attempt ${delivery.attempts}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={statusBadge(delivery.status).variant}>
                  {statusBadge(delivery.status).label}
                </Badge>
                {isRedeliverable(delivery.status) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={retryPending}
                    onClick={() => void retry(delivery.id)}
                  >
                    {pendingId === delivery.id ? 'Retrying…' : 'Retry'}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {redeliveredId === null ? null : (
        <p className="text-xs text-muted-foreground">
          <output>Delivery re-enqueued. A new attempt row will appear shortly.</output>
        </p>
      )}
    </div>
  )
}
