import { useEffect, useRef, useState } from 'react'
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Panel } from '@/components/page/panel'
import { ActionFeedback } from '@/components/page/action-feedback'
import { Spinner } from '@/components/ui/spinner'
import { useServerCall } from '@/hooks/use-server-call'
import { callServerFn } from '@/lib/server-call'
import { formatTimestampOr } from '@/lib/format-date'
import { statusLabel as deliveryStatusLabel } from '@/lib/value-labels'
import { type WebhookInvestigationTask } from '@b2b-saas-starter/capabilities/developer-platform/webhook-investigation-tasks'
import { m } from '@b2b-saas-starter/i18n/messages'

export type AssistantInvestigationPorts = {
  readonly tasks: ReadonlyArray<WebhookInvestigationTask>
  readonly deliveries?: ReadonlyArray<{
    readonly id: string
    readonly endpointId: string
    readonly endpointUrl: string
    readonly eventType: string
    readonly status: string
  }>
  readonly get?: (input: {
    readonly data: { readonly workspaceSlug: string; readonly taskId: string }
  }) => Promise<WebhookInvestigationTask>
  readonly create: (input: {
    readonly data: {
      readonly workspaceSlug: string
      readonly deliveryId: string
      readonly question: string
    }
  }) => Promise<WebhookInvestigationTask>
  readonly approve: (input: {
    readonly data: { readonly workspaceSlug: string; readonly taskId: string }
  }) => Promise<WebhookInvestigationTask>
  readonly cancel: (input: {
    readonly data: { readonly workspaceSlug: string; readonly taskId: string }
  }) => Promise<WebhookInvestigationTask>
}

function statusLabel(status: WebhookInvestigationTask['status']) {
  return {
    proposed: m.task_status_proposed(),
    approved: m.task_status_approved(),
    cancelled: m.task_status_cancelled(),
    completed: m.task_completed()
  }[status]
}

function diagnosisLabel(diagnosis: WebhookInvestigationTask['diagnosis']) {
  return {
    retrying: m.diagnosis_retrying(),
    delivered: m.diagnosis_delivered(),
    receiver_unavailable: m.diagnosis_receiver_unavailable(),
    receiver_rejected: m.diagnosis_receiver_rejected(),
    endpoint_disabled: m.diagnosis_endpoint_disabled(),
    unknown: m.diagnosis_unknown()
  }[diagnosis]
}

function outcomeLabel(outcome: NonNullable<WebhookInvestigationTask['outcome']>) {
  return {
    pending: m.assistant_replay_pending(),
    delivered: m.assistant_replay_delivered(),
    failed: m.assistant_replay_failed(),
    unavailable: m.assistant_replay_unavailable()
  }[outcome]
}

type InvestigationProps = {
  readonly workspaceSlug: string
  readonly investigation: AssistantInvestigationPorts
  readonly modelConfigured?: boolean | undefined
  readonly canReplay?: boolean | undefined
  readonly selectedDeliveryId?: string | undefined
  readonly selectedTaskId?: string | undefined
  readonly onSelectTask?: ((taskId: string) => void) | undefined
}

export function WorkspaceAssistantInvestigation(props: InvestigationProps) {
  return (
    <Investigation
      key={`${props.workspaceSlug}:${props.selectedTaskId ?? ''}:${props.selectedDeliveryId ?? ''}`}
      {...props}
    />
  )
}

function Investigation({
  workspaceSlug,
  investigation,
  modelConfigured,
  canReplay = false,
  selectedDeliveryId,
  selectedTaskId,
  onSelectTask
}: InvestigationProps) {
  const call = useServerCall()
  const queryClient = useQueryClient()
  const [deliveryId, setDeliveryId] = useState(selectedDeliveryId ?? '')
  const [question, setQuestion] = useState<string>(() =>
    m.assistant_investigation_default_question()
  )
  const [savedTasks, setSavedTasks] = useState<ReadonlyArray<WebhookInvestigationTask>>(
    []
  )
  const tasks = [
    ...savedTasks,
    ...investigation.tasks.filter(
      (task) => !savedTasks.some((saved) => saved.id === task.id)
    )
  ]
  const [activeTaskId, setActiveTaskId] = useState(
    selectedTaskId ??
      (selectedDeliveryId
        ? tasks.find((task) => task.sourceDeliveryId === selectedDeliveryId)?.id
        : tasks[0]?.id)
  )
  const [pending, setPending] = useState<'create' | 'approve' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const selectionVersion = useRef(0)
  useEffect(
    () => () => {
      selectionVersion.current += 1
    },
    []
  )

  const initialTask = tasks.find((task) => task.id === activeTaskId)
  const get = investigation.get
  const queryKey = ['assistant-investigation', workspaceSlug, activeTaskId]
  const taskQuery = useQuery({
    queryKey,
    queryFn:
      get && activeTaskId
        ? () =>
            callServerFn(
              () => get({ data: { workspaceSlug, taskId: activeTaskId } }),
              m.assistant_task_refresh_failed()
            )
        : skipToken,
    enabled: get !== undefined && activeTaskId !== undefined && pending === null,
    initialData:
      initialTask === undefined ? undefined : { ok: true, value: initialTask },
    staleTime: 0,
    retry: false,
    refetchInterval: (query) => {
      const result = query.state.data
      return result?.ok &&
        result.value.status === 'approved' &&
        result.value.outcome === 'pending'
        ? 5000
        : false
    }
  })
  const selected = taskQuery.data?.ok ? taskQuery.data.value : initialTask
  const refreshError = taskQuery.data?.ok === false ? taskQuery.data.message : null

  function remember(task: WebhookInvestigationTask) {
    queryClient.setQueryData(['assistant-investigation', workspaceSlug, task.id], {
      ok: true,
      value: task
    })
    setSavedTasks((current) => [task, ...current.filter((item) => item.id !== task.id)])
  }

  function select(task: WebhookInvestigationTask) {
    selectionVersion.current += 1
    setPending(null)
    setError(null)
    setActiveTaskId(task.id)
    setDeliveryId(task.sourceDeliveryId)
    onSelectTask?.(task.id)
  }

  async function create() {
    const value = deliveryId.trim()
    if (!value || !question.trim() || pending) {
      return
    }
    const version = selectionVersion.current
    setPending('create')
    setError(null)
    const result = await call(
      () =>
        investigation.create({
          data: { workspaceSlug, deliveryId: value, question: question.trim() }
        }),
      m.investigation_failed()
    )
    if (version !== selectionVersion.current) {
      return
    }
    setPending(null)
    if (!result.ok) {
      setError(result.message)
      return
    }
    remember(result.value)
    select(result.value)
  }

  async function update(action: 'approve' | 'cancel') {
    if (!selected || pending || !canReplay) {
      return
    }
    const version = selectionVersion.current
    setPending(action)
    setError(null)
    await queryClient.cancelQueries({ queryKey })
    const result = await call(
      () => investigation[action]({ data: { workspaceSlug, taskId: selected.id } }),
      m.investigation_failed()
    )
    if (version !== selectionVersion.current) {
      return
    }
    if (result.ok) {
      remember(result.value)
      setPending(null)
      onSelectTask?.(result.value.id)
      return
    }
    // Approval can commit before the queue rejects. Read the saved approval so
    // retry uses its existing replay ID rather than presenting a new proposal.
    if (get) {
      const actual = await call(
        () => get({ data: { workspaceSlug, taskId: selected.id } }),
        m.assistant_task_refresh_failed()
      )
      if (version !== selectionVersion.current) {
        return
      }
      if (actual.ok) {
        remember(actual.value)
      }
    }
    setPending(null)
    setError(result.message)
  }

  const deliveries = investigation.deliveries ?? []
  const selectedDelivery = deliveries.find((delivery) => delivery.id === deliveryId)
  const visibleTasks =
    selected && !tasks.some((task) => task.id === selected.id)
      ? [selected, ...tasks]
      : tasks
  return (
    <Panel title={m.delivery_checks()} description={m.delivery_checks_description()}>
      <div className="grid gap-4">
        {modelConfigured === false ? (
          <p className="text-sm text-muted-foreground">
            {m.no_model_provider_configured()}
          </p>
        ) : null}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="delivery-id">{m.delivery_id_label()}</FieldLabel>
            {deliveries.length > 0 ? (
              <Select
                value={deliveryId || null}
                onValueChange={(value) => setDeliveryId(value ?? '')}
              >
                <SelectTrigger id="delivery-id" className="w-full min-w-0">
                  <SelectValue placeholder={m.assistant_select_delivery()}>
                    {selectedDelivery
                      ? `${selectedDelivery.eventType} · ${selectedDelivery.id}`
                      : deliveryId}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {deliveries.map((delivery) => (
                      <SelectItem key={delivery.id} value={delivery.id}>
                        <span className="grid min-w-0 gap-1 whitespace-normal wrap-anywhere">
                          <span>
                            {delivery.eventType} ·{' '}
                            {deliveryStatusLabel(delivery.status)}
                          </span>
                          <span>{delivery.endpointUrl}</span>
                          <span className="font-mono">{delivery.id}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="delivery-id"
                value={deliveryId}
                onChange={(event) => setDeliveryId(event.target.value)}
              />
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="investigation-question">
              {m.assistant_investigation_question()}
            </FieldLabel>
            <Input
              id="investigation-question"
              value={question}
              maxLength={2000}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </Field>
          <div>
            <Button
              disabled={pending !== null || !deliveryId.trim() || !question.trim()}
              onClick={() => void create()}
            >
              {pending === 'create' ? <Spinner data-icon="inline-start" /> : null}
              {m.investigate_action()}
            </Button>
          </div>
        </FieldGroup>
        <ActionFeedback error={error ?? refreshError} />
        {activeTaskId && get ? (
          <div>
            <Button
              variant="ghost"
              disabled={taskQuery.isFetching || pending !== null}
              onClick={() => void taskQuery.refetch()}
            >
              {taskQuery.isFetching ? <Spinner data-icon="inline-start" /> : null}
              {m.assistant_refresh_task()}
            </Button>
          </div>
        ) : null}
        {tasks.length > 0 || activeTaskId ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(11rem,0.7fr)_minmax(0,1.3fr)]">
            <ol className="grid content-start gap-1" aria-label={m.recent_tasks()}>
              {visibleTasks.map((task) => (
                <li key={task.id}>
                  <Button
                    variant={activeTaskId === task.id ? 'secondary' : 'ghost'}
                    className="h-auto min-h-11 w-full justify-start py-3 max-md:h-auto"
                    aria-pressed={activeTaskId === task.id}
                    onClick={() => select(task)}
                  >
                    <span className="grid min-w-0 gap-1 text-left">
                      <span className="truncate">{task.evidence.eventType}</span>
                      <span className="truncate">{task.evidence.endpointUrl}</span>
                      <span>
                        {statusLabel(
                          task.id === selected?.id ? selected.status : task.status
                        )}
                      </span>
                    </span>
                  </Button>
                </li>
              ))}
            </ol>
            {selected ? (
              <TaskDetail
                selected={selected}
                pending={pending}
                canReplay={canReplay}
                update={update}
              />
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{m.task_no_history()}</p>
        )}
      </div>
    </Panel>
  )
}

function TaskDetail({
  selected,
  pending,
  canReplay,
  update
}: {
  readonly selected: WebhookInvestigationTask
  readonly pending: 'create' | 'approve' | 'cancel' | null
  readonly canReplay: boolean
  readonly update: (action: 'approve' | 'cancel') => Promise<void>
}) {
  const replayRetryable =
    selected.status === 'approved' && selected.outcome !== 'delivered'
  return (
    <section
      aria-label={m.investigation_task()}
      className="grid min-w-0 content-start gap-4 border-t border-border pt-4 lg:border-t-0 lg:border-l lg:pl-4"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">{m.investigation_task()}</h2>
        <Badge variant="neutral">{statusLabel(selected.status)}</Badge>
      </div>
      <p className="text-sm">{selected.question}</p>
      <p className="text-sm">{diagnosisLabel(selected.diagnosis)}</p>
      <dl className="grid gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">{m.delivery_id_label()}</dt>
          <dd className="font-mono wrap-anywhere">{selected.sourceDeliveryId}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{m.webhook_endpoint()}</dt>
          <dd className="font-mono wrap-anywhere">{selected.evidence.endpointUrl}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{m.webhook_delivery_status()}</dt>
          <dd>{deliveryStatusLabel(selected.evidence.deliveryStatus)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{m.webhook_response_status()}</dt>
          <dd className="font-mono">
            {selected.evidence.lastResponseStatus ?? m.empty_value()}
          </dd>
        </div>
      </dl>
      <details>
        <summary className="cursor-pointer text-sm">{m.attempt_history()}</summary>
        <ol className="mt-3 grid gap-2 text-sm">
          {selected.evidence.attempts.map((attempt) => (
            <li key={attempt.id} className="flex flex-wrap justify-between gap-2">
              <span>{formatTimestampOr(attempt.attemptedAt, m.empty_value())}</span>
              <span>
                {deliveryStatusLabel(attempt.status)} ·{' '}
                {attempt.responseStatus ?? m.empty_value()}
              </span>
            </li>
          ))}
        </ol>
        {selected.evidence.attempts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.no_retained_attempts()}</p>
        ) : null}
      </details>
      {selected.replayDeliveryId ? (
        <p className="text-sm text-muted-foreground">
          {m.assistant_replay_delivery()}{' '}
          <span className="font-mono wrap-anywhere">{selected.replayDeliveryId}</span>
        </p>
      ) : null}
      {selected.outcome ? (
        <p className="text-sm font-medium">
          {m.replay_outcome({ outcome: outcomeLabel(selected.outcome) })}
        </p>
      ) : null}
      {selected.status === 'proposed' ? (
        <>
          <p className="text-sm">{m.assistant_replay_proposal()}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending !== null || !canReplay}
              onClick={() => void update('approve')}
            >
              {pending === 'approve' ? <Spinner data-icon="inline-start" /> : null}
              {m.approve_replay()}
            </Button>
            <Button
              variant="ghost"
              disabled={pending !== null || !canReplay}
              onClick={() => void update('cancel')}
            >
              {m.cancel_task()}
            </Button>
          </div>
        </>
      ) : null}
      {replayRetryable ? (
        <div>
          <Button
            disabled={pending !== null || !canReplay}
            onClick={() => void update('approve')}
          >
            {pending === 'approve' ? <Spinner data-icon="inline-start" /> : null}
            {m.retry_replay()}
          </Button>
        </div>
      ) : null}
      {!canReplay && (selected.status === 'proposed' || replayRetryable) ? (
        <p className="text-sm text-muted-foreground">
          {m.replay_permission_required()}
        </p>
      ) : null}
    </section>
  )
}
