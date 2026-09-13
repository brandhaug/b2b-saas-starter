import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader } from '@/components/page/page-header'
import { Panel } from '@/components/page/panel'
import { WorkspaceCrumb } from '@/components/page/workspace-crumb'
import { WorkspaceShell } from '@/components/workspace-shell'
import { useServerAction } from '@/hooks/use-server-action'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { viewerCan } from '@/lib/permissions'
import { Spinner } from '@/components/ui/spinner'
import {
  type AskAssistantOutcome,
  type AssistantPagePayload
} from '@/lib/server/assistant'
import {
  WorkspaceAssistantInvestigation,
  type AssistantInvestigationPorts
} from './workspace-assistant-investigation'
import { m } from '@b2b-saas-starter/i18n/messages'

export type AskAssistant = (input: {
  readonly data: {
    readonly workspaceSlug: string
    readonly question: string
    readonly taskId?: string
  }
}) => Promise<AskAssistantOutcome>
type TranscriptEntry = {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly provider: 'workers-ai' | 'openai-compatible' | 'mock' | null
}
const providerLabels = {
  'workers-ai': 'Workers AI',
  'openai-compatible': 'OpenAI-compatible',
  mock: 'Mock provider'
}

function Transcript({
  entries,
  enabled
}: {
  readonly entries: ReadonlyArray<TranscriptEntry>
  readonly enabled: boolean
}) {
  if (!entries.length) {
    return enabled ? (
      <p className="text-sm text-muted-foreground">{m.assistant_question_empty()}</p>
    ) : null
  }
  return (
    <ol className="grid gap-3" aria-label={m.conversation()} aria-live="polite">
      {entries.map((item) => (
        <li key={item.id} className="grid min-w-0 gap-1">
          <div className="text-xs font-medium text-muted-foreground">
            {item.role === 'user' ? m.assistant_you() : m.assistant_label()}
          </div>
          <div
            className={
              item.role === 'user'
                ? 'rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap wrap-anywhere'
                : 'rounded-md border border-border px-3 py-2 text-sm whitespace-pre-wrap wrap-anywhere'
            }
          >
            {item.text}
            {item.provider ? (
              <span className="mt-2 block text-xs text-muted-foreground">
                {providerLabels[item.provider]}
              </span>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

type AssistantPageProps = {
  readonly workspaceSlug: string
  readonly data: AssistantPagePayload
  readonly ask: AskAssistant
  readonly systemRole?: string | null | undefined
  readonly investigation?: AssistantInvestigationPorts | undefined
  readonly selectedDeliveryId?: string | undefined
  readonly selectedTaskId?: string | undefined
  readonly onSelectTask?: ((taskId: string) => void) | undefined
}

export function WorkspaceAssistantPage(props: AssistantPageProps) {
  return (
    <AssistantPage
      key={`${props.workspaceSlug}:${props.selectedTaskId ?? ''}:${props.selectedDeliveryId ?? ''}`}
      {...props}
    />
  )
}

function AssistantPage({
  workspaceSlug,
  data,
  ask,
  systemRole,
  investigation,
  selectedDeliveryId,
  selectedTaskId,
  onSelectTask
}: AssistantPageProps) {
  const [activeTaskId, setActiveTaskId] = useState(
    selectedTaskId ??
      (selectedDeliveryId
        ? investigation?.tasks.find(
            (task) => task.sourceDeliveryId === selectedDeliveryId
          )?.id
        : investigation?.tasks[0]?.id)
  )
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  function selectTask(taskId: string) {
    setActiveTaskId(taskId)
    onSelectTask?.(taskId)
  }
  const [question, setQuestion] = useState('')
  const action = useServerAction(ask, {
    failureMessage: m.assistant_unreachable(),
    invalidate: false
  })
  const pending = action.pending
  const [transcript, setTranscript] = useState<ReadonlyArray<TranscriptEntry>>([])
  const canUseAssistant =
    data.configured && viewerCan(data.viewer, { assistant: ['read'] })
  async function submit() {
    const trimmed = question.trim()
    if (!trimmed || pending) {
      return
    }
    setQuestion('')
    setTranscript((items) => [
      ...items,
      { id: crypto.randomUUID(), role: 'user', text: trimmed, provider: null }
    ])
    const request =
      activeTaskId === undefined
        ? { workspaceSlug, question: trimmed }
        : { workspaceSlug, question: trimmed, taskId: activeTaskId }
    const response = await action.runAsync({ data: request })
    if (!mounted.current) {
      return
    }
    const result = response.ok ? response.value : null
    const item: TranscriptEntry = result?.ok
      ? {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: result.answer,
          provider: result.provider
        }
      : {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: result?.message ?? m.assistant_unreachable(),
          provider: null
        }
    setTranscript((items) => [...items, item])
  }
  return (
    <WorkspaceShell
      workspaceSlug={workspaceSlug}
      systemRole={systemRole}
      viewer={data.viewer}
    >
      <PageHeader
        breadcrumb={<WorkspaceCrumb workspaceSlug={workspaceSlug} />}
        title={m.ai_assistant()}
        description={m.ask_workspace_description()}
      />
      <Panel
        title={m.nav_assistant()}
        actions={
          <Badge variant={canUseAssistant ? 'info' : 'outline'}>
            {canUseAssistant ? m.workspace_connected() : m.workspace_not_enabled()}
          </Badge>
        }
      >
        <Transcript entries={transcript} enabled={canUseAssistant} />
        {canUseAssistant ? (
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            {activeTaskId ? (
              <p className="font-mono text-xs text-muted-foreground">
                {m.assistant_task_context({ taskId: activeTaskId })}
              </p>
            ) : null}
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="assistant-question">
                  {m.your_question()}
                </FieldLabel>
                <Textarea
                  id="assistant-question"
                  aria-label={m.your_question()}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder={m.assistant_placeholder()}
                  disabled={pending}
                />
              </Field>
            </FieldGroup>
            <div className="flex justify-end">
              <Button type="submit" disabled={pending || !question.trim()}>
                {pending ? <Spinner data-icon="inline-start" /> : null}
                {m.ask_action()}
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            {m.assistant_chat_unavailable()}
          </p>
        )}
      </Panel>
      {investigation ? (
        <WorkspaceAssistantInvestigation
          workspaceSlug={workspaceSlug}
          investigation={investigation}
          modelConfigured={data.configured}
          canReplay={viewerCan(data.viewer, { webhook: ['replay'] })}
          selectedDeliveryId={selectedDeliveryId}
          selectedTaskId={selectedTaskId}
          onSelectTask={selectTask}
        />
      ) : null}
    </WorkspaceShell>
  )
}
