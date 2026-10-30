import { useRef } from 'react'
import { useForm, useSelector } from '@tanstack/react-form'
import { useServerAction } from '@/hooks/use-server-action'
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
  actorId,
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
  readonly actorId?: string | undefined
  readonly workspaceSlug: string
  readonly conversationId: string
  readonly configured: boolean
  readonly taskId?: string | undefined
  readonly taskIds: ReadonlyArray<string>
  readonly ports: ConversationPorts
  readonly onSelectTask: (id: string) => void
  readonly onDeleted: () => void | Promise<void>
  readonly onAccessLost: () => void
  readonly onChanged: () => void | Promise<void>
}) {
  const state = useAssistantConversation(
    workspaceSlug,
    conversationId,
    ports,
    onAccessLost,
    actorId
  )
  const form = useForm({
    defaultValues: { question: '' },
    onSubmit: async () => send()
  })
  const question = useSelector(form.store, (value) => value.values.question)
  const action = useServerAction(
    (input: {
      call: () => Promise<ConversationResult<unknown>>
      kind: 'change' | 'delete'
    }) => callConversation(input.call),
    {
      failureMessage: m.assistant_unreachable(),
      invalidate: false,
      identityKey: `${actorId ?? ''}:${workspaceSlug}:${conversationId}`,
      onSuccess: async (result, input) => {
        if (!result.ok) {
          return
        }
        if (input.kind === 'delete') {
          await onDeleted()
          return
        }
        await onChanged()
        await state.refresh()
      }
    }
  )
  const pending = action.pending
  const error =
    action.error ?? (action.result?.ok === false ? action.result.message : null)
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
    const result = await action.runAsync({ call, kind: 'change' })
    if (!result.ok || !result.value.ok) {
      return false
    }
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
      form.reset()
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
    await action.runAsync({
      kind: 'delete',
      call: () => ports.remove({ data: { workspaceSlug, conversationId } })
    })
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
              <AlertDialogAction disabled={blocked} onClick={() => void remove()}>
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
          void form.handleSubmit()
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
            onChange={(event) => form.setFieldValue('question', event.target.value)}
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
