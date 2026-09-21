import { CheckIcon, CircleIcon, XIcon } from 'lucide-react'
import { EvidenceCode } from '@/components/evidence-code'
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
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? m.hide_attempt_history() : m.view_attempt_history()}
      </Button>
      {expanded ? (
        <div id={historyId} className="grid min-w-0 gap-3">
          <EvidenceCode
            label={m.webhook_payload()}
            value={JSON.stringify(delivery.payload, null, 2)}
          />
          {attempts.isPending ? (
            <output className="text-sm text-muted-foreground">
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
            <p className="text-sm text-muted-foreground">{m.no_retained_attempts()}</p>
          ) : null}
          {attempts.data ? (
            <ol aria-label={m.attempt_history()} className="grid gap-5">
              {attempts.data.map((attempt) => (
                <li
                  key={attempt.id}
                  className="relative grid min-w-0 gap-2 border-l border-border pl-6 ml-3"
                >
                  <span
                    aria-hidden="true"
                    className="absolute -left-3 top-0 grid size-6 place-items-center rounded-full border border-border bg-card"
                  >
                    <AttemptStatusIcon status={attempt.status} />
                  </span>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
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
                  <p className="text-sm text-muted-foreground">
                    {formatTimestampOr(attempt.attemptedAt, '')}
                  </p>
                  {attempt.failureReason === null ? null : (
                    <p className="text-sm break-words">{attempt.failureReason}</p>
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
  if (attempt.requestHeaders === null && attempt.responseBody === null) {
    return null
  }
  return (
    <details className="group min-w-0">
      <summary className="w-fit cursor-pointer py-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring max-md:min-h-11">
        {m.evidence_attempt_details()}
      </summary>
      <div className="grid min-w-0 gap-3 pt-2">
        {attempt.requestHeaders === null ? null : (
          <EvidenceCode
            label={m.webhook_request_headers()}
            value={Object.entries(attempt.requestHeaders)
              .map(([name, value]) => `${name}: ${value}`)
              .join('\n')}
          />
        )}
        {attempt.responseBody === null ? null : (
          <div className="grid gap-1.5">
            <EvidenceCode
              label={m.response_body()}
              value={
                attempt.responseBody === '' ? m.empty_value() : attempt.responseBody
              }
            />
            <p className="text-sm text-muted-foreground">
              {m.webhook_bounded_excerpt()}
            </p>
          </div>
        )}
      </div>
    </details>
  )
}

function AttemptStatusIcon({
  status
}: {
  readonly status: WebhookDeliveryAttempt['status']
}) {
  if (status === 'delivered') {
    return <CheckIcon className="size-3 text-status-ok" />
  }
  if (webhookDeliveryStatusVariant(status) === 'destructive') {
    return <XIcon className="size-3 text-destructive" />
  }
  return <CircleIcon className="size-3 text-status-warn" />
}
