import { statusLabel } from '@/lib/value-labels'
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
import { formatTimestampOr } from '@/lib/format-date'
import { listWebhookDeliveryAttemptsServerFn } from '@/lib/server/webhooks'
import { m } from '@b2b-saas-starter/i18n/messages'

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
        {expanded ? m.hide_attempt_history() : m.view_attempt_history()}
      </Button>
      {expanded ? (
        <div id={historyId} className="grid min-w-0 gap-3">
          <div>
            <p className="mb-1 text-xs font-medium">{m.webhook_payload()}</p>
            <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs break-all whitespace-pre-wrap">
              {JSON.stringify(delivery.payload, null, 2)}
            </pre>
          </div>
          {attempts.isPending ? (
            <output className="text-xs text-muted-foreground">
              {m.loading_attempt_history()}
            </output>
          ) : null}
          {attempts.isError ? (
            <div>
              <ActionFeedback error={m.load_attempt_history_failed()} />
              <Button
                variant="outline"
                size="xs"
                disabled={attempts.isFetching}
                onClick={() => void attempts.refetch()}
              >
                {m.retry_action()}
              </Button>
            </div>
          ) : null}
          {attempts.data?.length === 0 ? (
            <p className="text-xs text-muted-foreground">{m.no_retained_attempts()}</p>
          ) : null}
          {attempts.data ? (
            <ol
              aria-label={m.attempt_history()}
              className="grid gap-3 border-l border-border pl-3"
            >
              {attempts.data.map((attempt) => (
                <li key={attempt.id} className="grid min-w-0 gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium">
                      {attempt.phase === 'terminal'
                        ? m.terminal_outcome()
                        : m.attempt_count({ count: attempt.attempts })}
                    </span>
                    <Badge variant={webhookDeliveryStatusVariant(attempt.status)}>
                      {statusLabel(attempt.status)}
                    </Badge>
                    {attempt.responseStatus === null ? null : (
                      <span className="font-mono">HTTP {attempt.responseStatus}</span>
                    )}
                    {attempt.durationMs === null ? null : (
                      <span className="font-mono">{attempt.durationMs} ms</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatTimestampOr(attempt.attemptedAt, '')}
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
          <dt className="mb-1 font-medium">{m.webhook_request_headers()}</dt>
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
            {m.response_body()}{' '}
            <span className="font-normal text-muted-foreground">
              {m.webhook_bounded_excerpt()}
            </span>
          </dt>
          <dd>
            <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono break-all whitespace-pre-wrap">
              {attempt.responseBody === '' ? m.empty_value() : attempt.responseBody}
            </pre>
          </dd>
        </div>
      )}
    </dl>
  )
}
