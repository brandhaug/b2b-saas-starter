import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  type ConversationPorts,
  type ConversationResult
} from '@/lib/server/assistant-conversations'
import { useAssistantConversation } from '@/hooks/use-assistant-conversation'
import { callConversation } from '@/lib/assistant-conversation-call'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { ActionFeedback } from '@/components/page/action-feedback'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction
} from '@/components/ui/alert-dialog'
import { ConversationHistoryList } from './workspace-assistant-conversations-history'
import { m } from '@b2b-saas-starter/i18n/messages'

export function ConversationDetail({
  workspaceSlug,
  conversationId,
  configured,
  taskId,
  taskIds,
  ports,
  onSelectTask,
  onDeleted,
  onChanged,
  onAccessLost
}: {
  readonly workspaceSlug: string
  readonly conversationId: string
  readonly configured: boolean
  readonly taskId?: string | undefined
  readonly taskIds: ReadonlyArray<string>
  readonly ports: ConversationPorts
  readonly onSelectTask: (id: string) => void
  readonly onDeleted: () => void
  readonly onAccessLost: () => void
  readonly onChanged: () => void
}) {
  const state = useAssistantConversation(
    workspaceSlug,
    conversationId,
    ports,
    onAccessLost
  )
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sendIntent = useRef<{
    readonly question: string
    readonly taskId: string | undefined
    readonly key: string
  } | null>(null)
  const retryIntent = useRef<{
    readonly attemptId: string
    readonly key: string
  } | null>(null)
  const latest = state.history?.items.at(-1)?.attempts.at(-1)
  const active = latest?.status === 'Accepted' || latest?.status === 'Running'
  const blocked = pending || state.connection === 'denied'
  async function perform<A>(
    call: () => Promise<ConversationResult<A>>
  ): Promise<boolean> {
    if (pending) {
      return false
    }
    setPending(true)
    setError(null)
    const result = await callConversation(call)
    // oxlint-disable-next-line react-doctor/no-loading-flag-reset-outside-finally -- callConversation folds transport rejections into a result and never rejects.
    setPending(false)
    if (!result.ok) {
      setError(result.message)
      return false
    }
    onChanged()
    await state.refresh()
    return true
  }
  async function send() {
    const text = question.trim()
    if (!text || blocked || active || !configured) {
      return
    }
    let intent = sendIntent.current
    if (!intent || intent.question !== text || intent.taskId !== taskId) {
      intent = { question: text, taskId, key: crypto.randomUUID() }
      sendIntent.current = intent
    }
    const data = {
      workspaceSlug,
      conversationId,
      question: text,
      idempotencyKey: intent.key
    }
    if (taskId !== undefined) {
      Object.assign(data, { taskId })
    }
    if (await perform(() => ports.send({ data }))) {
      setQuestion('')
      sendIntent.current = null
    }
  }
  async function retry(attemptId: string) {
    let intent = retryIntent.current
    if (!intent || intent.attemptId !== attemptId) {
      intent = { attemptId, key: crypto.randomUUID() }
      retryIntent.current = intent
    }
    const data = {
      workspaceSlug,
      conversationId,
      attemptId,
      idempotencyKey: intent.key
    }
    if (await perform(() => ports.retry({ data }))) {
      retryIntent.current = null
    }
  }
  async function remove() {
    setPending(true)
    const result = await callConversation(() =>
      ports.remove({ data: { workspaceSlug, conversationId } })
    )
    // oxlint-disable-next-line react-doctor/no-loading-flag-reset-outside-finally -- callConversation folds transport rejections into a result and never rejects.
    setPending(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    onDeleted()
  }
  // oxlint-disable-next-line react-doctor/prefer-module-scope-static-value -- Locale message functions must run during render after language changes.
  const connectionLabels = {
    connected: m.assistant_conversations_live(),
    denied: m.assistant_conversations_access_lost(),
    connecting: m.assistant_conversations_loading(),
    reconnecting: m.assistant_conversations_reconnecting()
  }
  return (
    <div className="grid min-w-0 content-start gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <output className="text-xs text-muted-foreground">
          {connectionLabels[state.connection]}
        </output>
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button variant="ghost" size="xs" disabled={blocked} />}
          >
            {m.assistant_conversations_delete()}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>
              {m.assistant_conversations_delete_title()}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {m.assistant_conversations_delete_description()}
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void remove()}>
                {m.assistant_conversations_delete()}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {state.history?.nextCursor ? (
        <Button
          variant="outline"
          size="xs"
          disabled={state.loading}
          onClick={() => void state.loadOlder()}
        >
          {m.assistant_conversations_older()}
        </Button>
      ) : null}
      {state.loading && state.history === null ? (
        <div className="flex items-center gap-2 text-sm">
          <Spinner />
          {m.assistant_conversations_loading()}
        </div>
      ) : null}
      {state.history ? (
        <ConversationHistoryList
          items={state.history.items}
          configured={configured}
          pending={blocked}
          taskIds={taskIds}
          onSelectTask={onSelectTask}
          onRetry={(id) => void retry(id)}
          onStop={(attemptId) =>
            void perform(() =>
              ports.stop({ data: { workspaceSlug, conversationId, attemptId } })
            )
          }
        />
      ) : null}
      {state.history?.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{m.assistant_question_empty()}</p>
      ) : null}
      <ActionFeedback error={error ?? state.error} />
      {state.connection === 'denied' ? (
        <Button variant="outline" onClick={state.reconnect}>
          {m.assistant_conversations_reconnect()}
        </Button>
      ) : null}
      {configured ? null : (
        <div className="grid gap-2 text-sm text-muted-foreground">
          <p>{m.assistant_conversations_configuration()}</p>
          <Link
            to="/docs/$category/$slug"
            params={{ category: 'getting-started', slug: 'optional-providers' }}
            className="text-primary underline underline-offset-4"
          >
            {m.assistant_setup_docs()}
          </Link>
        </div>
      )}
      <form
        className="grid gap-3 border-t border-border pt-4"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        {taskId ? (
          <p className="text-sm text-muted-foreground">
            {m.assistant_task_context({ taskId })}
          </p>
        ) : null}
        <Field>
          <FieldLabel htmlFor="conversation-question">{m.your_question()}</FieldLabel>
          <Textarea
            id="conversation-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={2000}
            rows={3}
            disabled={blocked || active || !configured}
            placeholder={m.assistant_placeholder()}
          />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {active
              ? m.assistant_conversations_busy()
              : m.assistant_conversations_leave_safe()}
          </p>
          <Button
            type="submit"
            disabled={blocked || active || !configured || !question.trim()}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {m.ask_action()}
          </Button>
        </div>
      </form>
    </div>
  )
}
