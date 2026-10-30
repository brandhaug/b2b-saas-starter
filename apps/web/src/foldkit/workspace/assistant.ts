import { Effect, type Types } from 'effect'
import { m } from '@b2b-saas-starter/i18n/messages'
import * as Conversations from '@/lib/server/assistant-conversations'
import * as Tasks from '@/lib/server/assistant-tasks'
import { viewerCan } from '@/lib/permissions'
import { statusLabel } from '@/lib/value-labels'
import { formatTimestampOr } from '@/lib/format-date'
import { call, RequestFailure } from '../server-call'
import { type Action, type Model, type Result } from './model'
import {
  action,
  button,
  feedback,
  heading,
  field,
  link,
  panel,
  select,
  textarea,
  type H
} from './ui'

function accepted<A>(result: Conversations.ConversationResult<A>) {
  return result.ok
    ? Effect.succeed(result.value)
    : Effect.fail(new RequestFailure({ message: result.message }))
}
function incompleteReason(reason: string | null): string {
  if (reason === 'output_limit') {
    return m.assistant_conversations_output_limit()
  }
  if (reason === 'deadline_or_stop') {
    return m.assistant_conversations_deadline()
  }
  return m.assistant_conversations_incomplete()
}
export function execute(
  model: Model,
  operation: Extract<
    Action,
    {
      _tag:
        | 'ListConversations'
        | 'CreateConversation'
        | 'History'
        | 'Send'
        | 'RetryAnswer'
        | 'StopAnswer'
        | 'DeleteConversation'
        | 'Investigate'
        | 'ReadTask'
        | 'ApproveTask'
        | 'CancelTask'
    }
  >
) {
  const workspaceSlug = model.flags.slug
  const state = model.assistant
  const conversationId = state.conversationId ?? ''
  return Effect.gen(function* () {
    switch (operation._tag) {
      case 'ListConversations': {
        const data: Types.Mutable<
          Parameters<typeof Conversations.listConversationsServerFn>[0]['data']
        > = { workspaceSlug }
        if (operation.cursor) {
          data.cursor = operation.cursor
        }
        const result = yield* call(
          () =>
            Conversations.listConversationsServerFn({
              data
            }),
          m.assistant_conversations_access_lost()
        )
        if (
          !result.ok &&
          (result.reason === 'access' || result.reason === 'not_found')
        ) {
          return { _tag: 'AccessLost', message: result.message } satisfies Result
        }
        const page = yield* accepted(result)
        return {
          _tag: 'Conversations',
          items: page.items,
          nextCursor: page.nextCursor,
          append: operation.cursor !== null
        } satisfies Result
      }
      case 'CreateConversation': {
        const result = yield* call(
          () => Conversations.createConversationServerFn({ data: { workspaceSlug } }),
          m.investigation_failed()
        ).pipe(Effect.flatMap(accepted))
        return { _tag: 'CreatedConversation', id: result.id } satisfies Result
      }
      case 'History': {
        const data: Types.Mutable<
          Parameters<typeof Conversations.conversationHistoryServerFn>[0]['data']
        > = { workspaceSlug, conversationId }
        if (operation.cursor) {
          data.cursor = operation.cursor
        }
        const result = yield* call(
          () =>
            Conversations.conversationHistoryServerFn({
              data
            }),
          m.investigation_failed()
        )
        if (
          !result.ok &&
          (result.reason === 'access' || result.reason === 'not_found')
        ) {
          return { _tag: 'AccessLost', message: result.message } satisfies Result
        }
        const history = yield* accepted(result)
        return {
          _tag: 'History',
          history,
          cursor: operation.cursor,
          conversationId
        } satisfies Result
      }
      case 'Send': {
        const data: Types.Mutable<
          Parameters<typeof Conversations.sendConversationServerFn>[0]['data']
        > = {
          workspaceSlug,
          conversationId,
          question: state.question.trim(),
          idempotencyKey: state.intentKey
        }
        if (state.selectedTask) {
          data.taskId = state.selectedTask.id
        }
        yield* call(
          () =>
            Conversations.sendConversationServerFn({
              data
            }),
          m.assistant_unreachable()
        ).pipe(Effect.flatMap(accepted))
        break
      }
      case 'RetryAnswer': {
        yield* call(
          () =>
            Conversations.retryConversationServerFn({
              data: {
                workspaceSlug,
                conversationId,
                attemptId: operation.id,
                idempotencyKey: state.retryKey
              }
            }),
          m.investigation_failed()
        ).pipe(Effect.flatMap(accepted))
        break
      }
      case 'StopAnswer': {
        yield* call(
          () =>
            Conversations.stopConversationServerFn({
              data: { workspaceSlug, conversationId, attemptId: operation.id }
            }),
          m.investigation_failed()
        ).pipe(Effect.flatMap(accepted))
        break
      }
      case 'DeleteConversation': {
        yield* call(
          () =>
            Conversations.deleteConversationServerFn({
              data: { workspaceSlug, conversationId }
            }),
          m.investigation_failed()
        ).pipe(Effect.flatMap(accepted))
        return { _tag: 'DeletedConversation' } satisfies Result
      }
      case 'Investigate': {
        const task = yield* call(
          () =>
            Tasks.createAssistantTaskServerFn({
              data: {
                workspaceSlug,
                deliveryId: state.deliveryId,
                question: state.investigation
              }
            }),
          m.investigation_failed()
        )
        return { _tag: 'Task', task } satisfies Result
      }
      case 'ReadTask': {
        const task = yield* call(
          () =>
            Tasks.getAssistantTaskServerFn({
              data: { workspaceSlug, taskId: operation.id }
            }),
          m.assistant_task_refresh_failed()
        )
        return { _tag: 'Task', task } satisfies Result
      }
      case 'ApproveTask': {
        const task = yield* call(
          () =>
            Tasks.approveAssistantTaskServerFn({
              data: { workspaceSlug, taskId: operation.id }
            }),
          m.investigation_failed()
        )
        return { _tag: 'Task', task } satisfies Result
      }
      case 'CancelTask': {
        const task = yield* call(
          () =>
            Tasks.cancelAssistantTaskServerFn({
              data: { workspaceSlug, taskId: operation.id }
            }),
          m.investigation_failed()
        )
        return { _tag: 'Task', task } satisfies Result
      }
      default: {
        break
      }
    }
    return { _tag: 'Done', notice: m.common_done() } satisfies Result
  })
}

function investigation(model: Model, h: H) {
  if (model.page._tag !== 'assistant' || !model.page.data.investigations) {
    return h.div([], [])
  }
  const data = model.page.data
  const tasks = data.investigations
  const selected = model.assistant.selectedTask
  const canReplay = viewerCan(data.viewer, { webhook: ['replay'] })
  const taskStatuses = {
    proposed: m.task_status_proposed(),
    approved: m.task_status_approved(),
    cancelled: m.task_status_cancelled(),
    completed: m.task_completed()
  }
  const diagnoses = {
    retrying: m.diagnosis_retrying(),
    delivered: m.diagnosis_delivered(),
    receiver_unavailable: m.diagnosis_receiver_unavailable(),
    receiver_rejected: m.diagnosis_receiver_rejected(),
    endpoint_disabled: m.diagnosis_endpoint_disabled(),
    unknown: m.diagnosis_unknown()
  }
  const outcomes = {
    pending: m.assistant_replay_pending(),
    delivered: m.assistant_replay_delivered(),
    failed: m.assistant_replay_failed(),
    unavailable: m.assistant_replay_unavailable()
  }
  return panel(h, m.delivery_checks(), [
    h.p([h.Class('text-sm text-muted-foreground')], [m.delivery_checks_description()]),
    ...(data.configured ? [] : [h.p([], [m.no_model_provider_configured()])]),
    tasks?.deliveries.length
      ? select(
          h,
          m.assistant_select_delivery(),
          model.assistant.deliveryId,
          [
            ['', m.assistant_select_delivery()],
            ...tasks.deliveries.map(
              (delivery) =>
                [
                  delivery.id,
                  `${delivery.eventType} · ${delivery.endpointUrl} · ${statusLabel(delivery.status)}`
                ] as const
            )
          ],
          (value) => ({ _tag: 'AssistantField', field: 'deliveryId', value })
        )
      : field(
          h,
          'investigation-delivery',
          m.delivery_id_label(),
          model.assistant.deliveryId,
          (value) => ({ _tag: 'AssistantField', field: 'deliveryId', value })
        ),
    textarea(
      h,
      'investigation-request',
      m.assistant_investigation_question(),
      model.assistant.investigation,
      (value) => ({ _tag: 'AssistantField', field: 'investigation', value }),
      model.pending
    ),
    action(h, model, m.investigate_action(), { _tag: 'Investigate' }),
    h.div(
      [h.Class('grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]')],
      [
        h.ol(
          [
            h.Attribute('aria-label', m.recent_tasks()),
            h.Class('grid content-start gap-2')
          ],
          (tasks?.tasks ?? []).map((task) =>
            h.li(
              [],
              [
                button(h, `${task.evidence.eventType} · ${task.question}`, {
                  _tag: 'SelectTask',
                  id: task.id
                })
              ]
            )
          )
        ),
        ...(selected
          ? [
              h.article(
                [
                  h.Attribute('aria-label', m.investigation_task()),
                  h.Class('grid min-w-0 gap-4')
                ],
                [
                  h.h2([h.Class('font-medium')], [m.investigation_task()]),
                  h.p([], [selected.question]),
                  h.p([], [taskStatuses[selected.status]]),
                  h.p([], [diagnoses[selected.diagnosis]]),
                  h.dl(
                    [h.Class('grid gap-2 text-sm')],
                    [
                      [m.delivery_id_label(), selected.sourceDeliveryId],
                      [m.webhook_endpoint(), selected.evidence.endpointUrl],
                      [
                        m.webhook_delivery_status(),
                        statusLabel(selected.evidence.deliveryStatus)
                      ],
                      [
                        m.webhook_response_status(),
                        String(selected.evidence.lastResponseStatus ?? '—')
                      ]
                    ].map(([label, value]) =>
                      h.div(
                        [],
                        [
                          h.dt([h.Class('text-muted-foreground')], [label ?? '']),
                          h.dd([h.Class('break-all')], [value ?? ''])
                        ]
                      )
                    )
                  ),
                  h.details(
                    [],
                    [
                      h.summary([], [m.attempt_history()]),
                      ...selected.evidence.attempts.map((attempt) =>
                        h.p(
                          [],
                          [
                            `${formatTimestampOr(attempt.attemptedAt, m.empty_value())} · ${statusLabel(attempt.status)} · ${attempt.responseStatus ?? '—'}`
                          ]
                        )
                      )
                    ]
                  ),
                  ...(selected.replayDeliveryId
                    ? [
                        h.p(
                          [],
                          [
                            m.assistant_replay_delivery(),
                            h.span([], [selected.replayDeliveryId])
                          ]
                        )
                      ]
                    : []),
                  ...(selected.outcome
                    ? [
                        h.p(
                          [],
                          [m.replay_outcome({ outcome: outcomes[selected.outcome] })]
                        )
                      ]
                    : []),
                  ...(selected.status === 'proposed'
                    ? [
                        h.p([], [m.assistant_replay_proposal()]),
                        ...(canReplay
                          ? [
                              action(h, model, m.approve_replay(), {
                                _tag: 'ApproveTask',
                                id: selected.id
                              }),
                              action(h, model, m.cancel_task(), {
                                _tag: 'CancelTask',
                                id: selected.id
                              })
                            ]
                          : [
                              button(h, m.approve_replay(), { _tag: 'Noop' }, true),
                              h.p([], [m.replay_permission_required()])
                            ])
                      ]
                    : []),
                  ...(selected.status === 'approved' &&
                  canReplay &&
                  selected.outcome !== 'delivered'
                    ? [
                        action(h, model, m.retry_replay(), {
                          _tag: 'ApproveTask',
                          id: selected.id
                        })
                      ]
                    : []),
                  action(h, model, m.assistant_refresh_task(), {
                    _tag: 'ReadTask',
                    id: selected.id
                  })
                ]
              )
            ]
          : [h.p([], [m.task_no_history()])])
      ]
    )
  ])
}
export function view(model: Model, h: H) {
  if (model.page._tag !== 'assistant') {
    return h.div([], [])
  }
  const data = model.page.data
  const state = model.assistant
  if (model.flags.preview) {
    return h.div(
      [h.Class('grid gap-6')],
      [
        heading(h, m.ai_assistant(), m.ask_workspace_description()),
        panel(h, m.nav_assistant(), [
          h.p([], [m.workspace_not_enabled()]),
          h.p([], [m.assistant_chat_unavailable()]),
          h.p([], [m.assistant_unavailable_description()]),
          link(h, '/docs/getting-started/optional-providers', m.assistant_setup_docs()),
          h.p(
            [h.Class('text-sm text-muted-foreground')],
            [m.assistant_example_prompt()]
          )
        ])
      ]
    )
  }
  const latest = state.history?.items.at(-1)?.attempts.at(-1)
  const active = latest?.status === 'Accepted' || latest?.status === 'Running'
  const blocked = model.pending || state.connection === 'denied'
  const labels = {
    connecting: m.assistant_conversations_loading(),
    connected: m.assistant_conversations_live(),
    reconnecting: m.assistant_conversations_reconnecting(),
    denied: m.assistant_conversations_access_lost()
  }
  const statuses = {
    Accepted: m.assistant_conversations_accepted(),
    Running: m.assistant_conversations_running(),
    Completed: m.assistant_conversations_completed(),
    Interrupted: m.assistant_conversations_interrupted(),
    Stopped: m.assistant_conversations_stopped()
  }
  return h.div(
    [h.Class('grid gap-6')],
    [
      heading(h, m.ai_assistant(), m.ask_workspace_description()),
      investigation(model, h),
      panel(h, m.assistant_conversations_title(), [
        h.p([], [m.assistant_conversations_private()]),
        action(h, model, m.assistant_conversations_new(), {
          _tag: 'CreateConversation'
        }),
        h.div(
          [
            h.Class(
              'grid min-w-0 gap-6 md:grid-cols-[minmax(11rem,14rem)_minmax(0,1fr)]'
            )
          ],
          [
            h.nav(
              [
                h.Attribute('aria-label', m.assistant_conversations_title()),
                h.Class(
                  'grid content-start gap-2 border-b pb-4 md:border-r md:border-b-0 md:pr-4'
                )
              ],
              [
                ...state.conversations.map((conversation) =>
                  button(
                    h,
                    conversation.title ?? m.assistant_conversations_untitled(),
                    { _tag: 'SelectConversation', id: conversation.id }
                  )
                ),
                ...(state.nextCursor
                  ? [
                      action(h, model, m.assistant_conversations_more(), {
                        _tag: 'ListConversations',
                        cursor: state.nextCursor
                      })
                    ]
                  : [])
              ]
            ),
            ...(state.conversationId
              ? [
                  h.div(
                    [h.Class('grid min-w-0 content-start gap-5')],
                    [
                      h.div(
                        [h.Class('flex flex-wrap justify-between gap-3')],
                        [
                          h.output(
                            [h.Class('text-sm text-muted-foreground')],
                            [labels[state.connection]]
                          ),
                          action(
                            h,
                            model,
                            m.assistant_conversations_delete(),
                            { _tag: 'DeleteConversation' },
                            true
                          )
                        ]
                      ),
                      ...(state.history?.nextCursor
                        ? [
                            action(h, model, m.assistant_conversations_older(), {
                              _tag: 'History',
                              cursor: state.history.nextCursor
                            })
                          ]
                        : []),
                      ...(state.history?.items.length === 0
                        ? [h.p([], [m.assistant_question_empty()])]
                        : []),
                      ...(state.history?.items ?? []).map((exchange) =>
                        h.section(
                          [h.Class('grid gap-4 border-b py-4')],
                          [
                            h.p([], [m.assistant_you()]),
                            h.h3(
                              [h.Class('font-medium whitespace-pre-wrap')],
                              [exchange.question.text]
                            ),
                            ...(exchange.question.taskId &&
                            !(data.investigations?.tasks ?? []).some(
                              (task) => task.id === exchange.question.taskId
                            )
                              ? [
                                  h.p(
                                    [],
                                    [
                                      m.assistant_conversations_task_unavailable({
                                        taskId: exchange.question.taskId
                                      })
                                    ]
                                  )
                                ]
                              : []),
                            ...exchange.attempts.map((attempt, index) =>
                              h.article(
                                [
                                  h.Class('grid gap-2'),
                                  h.Attribute(
                                    'aria-label',
                                    m.assistant_conversations_attempt({
                                      number: index + 1
                                    })
                                  )
                                ],
                                [
                                  h.p(
                                    [
                                      h.Class('whitespace-pre-wrap break-words text-sm')
                                    ],
                                    [
                                      attempt.text ||
                                        (attempt.status === 'Accepted' ||
                                        attempt.status === 'Running'
                                          ? m.assistant_conversations_waiting()
                                          : m.assistant_conversations_no_text())
                                    ]
                                  ),
                                  ...(attempt.provider
                                    ? [h.p([], [attempt.provider])]
                                    : []),
                                  ...(['Interrupted', 'Stopped'].includes(
                                    attempt.status
                                  )
                                    ? [
                                        h.p(
                                          [],
                                          [m.assistant_conversations_saved_partial()]
                                        )
                                      ]
                                    : []),
                                  ...(attempt.omittedExchanges > 0
                                    ? [
                                        h.p(
                                          [],
                                          [
                                            m.assistant_conversations_omitted({
                                              count: attempt.omittedExchanges
                                            })
                                          ]
                                        )
                                      ]
                                    : []),
                                  h.p(
                                    [h.Class('text-sm text-muted-foreground')],
                                    [
                                      statuses[attempt.status],
                                      ...(['Interrupted', 'Stopped'].includes(
                                        attempt.status
                                      )
                                        ? [incompleteReason(attempt.reason)]
                                        : [])
                                    ]
                                  ),
                                  ...(attempt.evidence
                                    ? [
                                        h.details(
                                          [],
                                          [
                                            h.summary(
                                              [],
                                              [
                                                m.assistant_task_context({
                                                  taskId: attempt.evidence.taskId
                                                })
                                              ]
                                            ),
                                            h.p(
                                              [],
                                              [
                                                m.assistant_conversations_historical({
                                                  taskId: attempt.evidence.taskId,
                                                  sourceId: attempt.evidence.sourceId,
                                                  time: formatTimestampOr(
                                                    attempt.evidence.observedAt,
                                                    m.empty_value()
                                                  )
                                                })
                                              ]
                                            ),
                                            h.p(
                                              [h.Class('whitespace-pre-wrap')],
                                              [attempt.evidence.text]
                                            )
                                          ]
                                        )
                                      ]
                                    : []),
                                  ...(attempt.status === 'Accepted' ||
                                  attempt.status === 'Running'
                                    ? [
                                        action(
                                          h,
                                          model,
                                          m.assistant_conversations_stop(),
                                          { _tag: 'StopAnswer', id: attempt.id }
                                        )
                                      ]
                                    : []),
                                  ...((attempt.status === 'Interrupted' ||
                                    attempt.status === 'Stopped') &&
                                  attempt.id === exchange.attempts.at(-1)?.id
                                    ? [
                                        button(
                                          h,
                                          m.assistant_conversations_retry(),
                                          {
                                            _tag: 'Perform',
                                            action: {
                                              _tag: 'RetryAnswer',
                                              id: attempt.id
                                            }
                                          },
                                          blocked || !data.configured
                                        )
                                      ]
                                    : [])
                                ]
                              )
                            )
                          ]
                        )
                      ),
                      ...(state.connection === 'denied'
                        ? [
                            button(h, m.assistant_conversations_reconnect(), {
                              _tag: 'Reconnect'
                            })
                          ]
                        : []),
                      ...(data.configured
                        ? []
                        : [
                            h.p(
                              [h.Class('text-sm text-muted-foreground')],
                              [m.assistant_conversations_configuration()]
                            ),
                            link(
                              h,
                              '/docs/getting-started/optional-providers',
                              m.assistant_setup_docs()
                            )
                          ]),
                      textarea(
                        h,
                        'conversation-question',
                        m.your_question(),
                        state.question,
                        (value) => ({
                          _tag: 'AssistantField',
                          field: 'question',
                          value
                        }),
                        blocked || active || !data.configured,
                        m.assistant_placeholder()
                      ),
                      h.p(
                        [h.Class('text-sm text-muted-foreground')],
                        [
                          active
                            ? m.assistant_conversations_busy()
                            : m.assistant_conversations_leave_safe()
                        ]
                      ),
                      button(
                        h,
                        m.ask_action(),
                        { _tag: 'Perform', action: { _tag: 'Send' } },
                        blocked || active || !data.configured || !state.question.trim()
                      )
                    ]
                  )
                ]
              : [
                  h.p([], [m.assistant_conversations_choose()]),
                  ...(data.configured
                    ? []
                    : [
                        h.p([], [m.assistant_chat_unavailable()]),
                        h.p([], [m.assistant_unavailable_description()]),
                        link(
                          h,
                          '/docs/getting-started/optional-providers',
                          m.assistant_setup_docs()
                        ),
                        h.p([], [m.assistant_example_prompt()])
                      ])
                ])
          ]
        )
      ]),
      feedback(h, model)
    ]
  )
}
