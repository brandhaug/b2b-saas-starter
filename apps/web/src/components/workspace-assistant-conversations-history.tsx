import {
  type ConversationExchange,
  type ConversationAnswer,
  type ConversationStatus
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatTimestamp } from '@/lib/format-date'
import { m } from '@b2b-saas-starter/i18n/messages'

function statusLabel(status: ConversationStatus): string {
  switch (status) {
    case 'Accepted': {
      return m.assistant_conversations_accepted()
    }
    case 'Running': {
      return m.assistant_conversations_running()
    }
    case 'Completed': {
      return m.assistant_conversations_completed()
    }
    case 'Interrupted': {
      return m.assistant_conversations_interrupted()
    }
    case 'Stopped': {
      return m.assistant_conversations_stopped()
    }
  }
}

function incompleteReason(reason: string | null) {
  if (reason === 'output_limit') {
    return m.assistant_conversations_output_limit()
  }
  if (reason === 'deadline_or_stop') {
    return m.assistant_conversations_deadline()
  }
  return m.assistant_conversations_incomplete()
}

function Answer({
  answer,
  number,
  latest,
  pending,
  onRetry,
  onStop
}: {
  readonly answer: ConversationAnswer
  readonly number: number
  readonly latest: boolean
  readonly pending: boolean
  readonly onRetry: (attemptId: string) => void
  readonly onStop: (attemptId: string) => void
}) {
  const active = answer.status === 'Accepted' || answer.status === 'Running'
  const incomplete = answer.status === 'Interrupted' || answer.status === 'Stopped'
  return (
    <article
      className="grid gap-2 border-t border-border pt-3"
      aria-label={m.assistant_conversations_attempt({ number })}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{m.assistant_conversations_attempt({ number })}</span>
        <Badge variant={incomplete ? 'warn' : 'outline'}>
          {statusLabel(answer.status)}
        </Badge>
        <time dateTime={answer.createdAt}>
          {formatTimestamp(answer.createdAt, {
            dateStyle: 'short',
            timeStyle: 'short'
          })}
        </time>
      </div>
      {answer.omittedExchanges > 0 ? (
        <p className="text-sm text-muted-foreground">
          {m.assistant_conversations_omitted({ count: answer.omittedExchanges })}
        </p>
      ) : null}
      <p className="text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere">
        {answer.text ||
          (active
            ? m.assistant_conversations_waiting()
            : m.assistant_conversations_no_text())}
      </p>
      {answer.evidence ? (
        <p className="text-sm text-muted-foreground">
          {m.assistant_conversations_historical({
            taskId: answer.evidence.taskId,
            sourceId: answer.evidence.sourceId,
            time: formatTimestamp(answer.evidence.observedAt, {
              dateStyle: 'short',
              timeStyle: 'short'
            })
          })}
        </p>
      ) : null}
      {answer.provider ? (
        <p className="text-sm text-muted-foreground">
          {answer.provider}
          {answer.modelId ? ` · ${answer.modelId}` : ''}
        </p>
      ) : null}
      {incomplete ? (
        <p className="text-sm text-muted-foreground">
          {incompleteReason(answer.reason)}
        </p>
      ) : null}
      {answer.status === 'Interrupted' ? (
        <p className="text-sm text-muted-foreground">
          {m.assistant_conversations_saved_partial()}
        </p>
      ) : null}
      {latest && (active || incomplete) ? (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="xs"
            disabled={pending}
            onClick={() => (active ? onStop(answer.id) : onRetry(answer.id))}
          >
            {active
              ? m.assistant_conversations_stop()
              : m.assistant_conversations_retry()}
          </Button>
        </div>
      ) : null}
    </article>
  )
}

export function ConversationHistoryList({
  items,
  pending,
  configured,
  taskIds,
  onSelectTask,
  onRetry,
  onStop
}: {
  readonly items: ReadonlyArray<ConversationExchange>
  readonly pending: boolean
  readonly configured: boolean
  readonly taskIds: ReadonlyArray<string>
  readonly onSelectTask: (taskId: string) => void
  readonly onRetry: (attemptId: string) => void
  readonly onStop: (attemptId: string) => void
}) {
  const latestQuestionId = items.at(-1)?.question.id
  const latestAttemptId = items.at(-1)?.attempts.at(-1)?.id
  const availableTasks = new Set(taskIds)
  return (
    <ol className="grid gap-8" aria-label={m.conversation()}>
      {items.map(({ question, attempts }) => (
        <li key={question.id} className="grid min-w-0 gap-3">
          <div className="grid gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
              <span>{m.assistant_you()}</span>
              <time dateTime={question.createdAt}>
                {formatTimestamp(question.createdAt, {
                  dateStyle: 'short',
                  timeStyle: 'short'
                })}
              </time>
            </div>
            <p className="text-sm font-medium whitespace-pre-wrap wrap-anywhere">
              {question.text}
            </p>
            {question.taskId ? (
              <div className="text-xs text-muted-foreground">
                {availableTasks.has(question.taskId) ? (
                  <Button
                    variant="link"
                    size="xs"
                    onClick={() => onSelectTask(question.taskId ?? '')}
                  >
                    {m.assistant_task_context({ taskId: question.taskId })}
                  </Button>
                ) : (
                  m.assistant_conversations_task_unavailable({
                    taskId: question.taskId
                  })
                )}
              </div>
            ) : null}
          </div>
          {attempts.map((attempt, index) => (
            <Answer
              key={attempt.id}
              answer={attempt}
              number={index + 1}
              latest={
                question.id === latestQuestionId && attempt.id === latestAttemptId
              }
              pending={
                pending ||
                (!configured &&
                  attempt.status !== 'Accepted' &&
                  attempt.status !== 'Running')
              }
              onRetry={onRetry}
              onStop={onStop}
            />
          ))}
        </li>
      ))}
    </ol>
  )
}
