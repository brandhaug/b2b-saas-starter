import {
  type WebhookDelivery,
  type WebhookDeliveryAttempt
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ActionFeedback } from '@/components/page/action-feedback'
import { webhookDeliveryStatusVariant } from '@/lib/badge-variants'
import { formatUtcOr } from '@/lib/format-date'
import { listWebhookDeliveryAttemptsServerFn } from '@/lib/server/webhooks'

export type ListDeliveryAttempts = (input: {
  readonly data: { readonly workspaceSlug: string; readonly deliveryId: string }
}) => Promise<ReadonlyArray<WebhookDeliveryAttempt>>

export function WebhookDeliveryTimeline({
  workspaceSlug,
  delivery,
  listAttempts = listWebhookDeliveryAttemptsServerFn
}: {
  readonly workspaceSlug: string
  readonly delivery: WebhookDelivery
  readonly listAttempts?: ListDeliveryAttempts
}) {
  const historyId = useId()
  const [expanded, setExpanded] = useState(false)
  const attempts = useQuery({
    queryKey: [
      'webhook-attempts',
      workspaceSlug,
      delivery.id,
      delivery.attempts,
      delivery.status
    ],
    queryFn: () => listAttempts({ data: { workspaceSlug, deliveryId: delivery.id } }),
    enabled: expanded,
    retry: false
  })
  return (
    <div className="grid min-w-0 gap-2">
      <Button
        variant="ghost"
        size="xs"
        className="justify-self-start"
        aria-expanded={expanded}
        aria-controls={historyId}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? 'Hide' : 'View'} attempt history
      </Button>
      {expanded ? (
        <div id={historyId} className="grid min-w-0 gap-3">
          <div>
            <p className="mb-1 text-xs font-medium">Payload</p>
            <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs break-all whitespace-pre-wrap">
              {JSON.stringify(delivery.payload, null, 2)}
            </pre>
          </div>
          {attempts.isPending ? (
            <output className="text-xs text-muted-foreground">
              Loading attempt history…
            </output>
          ) : null}
          {attempts.isError ? (
            <div>
              <ActionFeedback error="Could not load attempt history." />
              <Button
                variant="outline"
                size="xs"
                disabled={attempts.isFetching}
                onClick={() => void attempts.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : null}
          {attempts.data?.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No retained attempts. Delivery evidence is kept for 30 days.
            </p>
          ) : null}
          {attempts.data ? (
            <ol
              aria-label="Attempt history"
              className="grid gap-3 border-l border-border pl-3"
            >
              {attempts.data.map((attempt) => (
                <li key={attempt.id} className="grid min-w-0 gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium">
                      {attempt.phase === 'terminal'
                        ? 'Terminal outcome'
                        : `Attempt ${attempt.attempts}`}
                    </span>
                    <Badge variant={webhookDeliveryStatusVariant(attempt.status)}>
                      {attempt.status}
                    </Badge>
                    {attempt.responseStatus === null ? null : (
                      <span className="font-mono">HTTP {attempt.responseStatus}</span>
                    )}
                    {attempt.durationMs === null ? null : (
                      <span className="font-mono">{attempt.durationMs} ms</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatUtcOr(attempt.attemptedAt, '')}
                  </p>
                  {attempt.failureReason === null ? null : (
                    <p className="text-xs break-words">{attempt.failureReason}</p>
                  )}
                  <AttemptEvidence attempt={attempt} />
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function AttemptEvidence({ attempt }: { readonly attempt: WebhookDeliveryAttempt }) {
  return (
    <dl className="grid min-w-0 gap-2 text-xs">
      {attempt.requestHeaders === null ? null : (
        <div>
          <dt className="mb-1 font-medium">Request headers</dt>
          <dd>
            <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono break-all whitespace-pre-wrap">
              {Object.entries(attempt.requestHeaders)
                .map(([name, value]) => `${name}: ${value}`)
                .join('\n')}
            </pre>
          </dd>
        </div>
      )}
      {attempt.responseBody === null ? null : (
        <div>
          <dt className="mb-1 font-medium">
            Response body{' '}
            <span className="font-normal text-muted-foreground">(bounded excerpt)</span>
          </dt>
          <dd>
            <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono break-all whitespace-pre-wrap">
              {attempt.responseBody === '' ? '(empty)' : attempt.responseBody}
            </pre>
          </dd>
        </div>
      )}
    </dl>
  )
}
