import { Effect } from 'effect'
import { m } from '@b2b-saas-starter/i18n/messages'
import * as Api from '@/lib/server/webhooks'
import { viewerCan } from '@/lib/permissions'
import { statusLabel } from '@/lib/value-labels'
import { formatTimestampOr } from '@/lib/format-date'
import { webhookDeliveryStatusVariant } from '@/lib/badge-variants'
import { WEBHOOK_EVENT_TYPES } from '@b2b-saas-starter/capabilities/developer-platform/webhook-events'
import { call } from '../server-call'
import { type Action, type Model, type Result } from './model'
import {
  action,
  button,
  checkbox,
  feedback,
  field,
  heading,
  href,
  link,
  panel,
  row,
  secret,
  tabs,
  tabPanel,
  query,
  actionMenu,
  type H
} from './ui'
import { listControls, paged, pagination } from './table'

export function execute(
  model: Model,
  operation: Extract<
    Action,
    {
      _tag:
        | 'CreateWebhook'
        | 'SaveWebhook'
        | 'ToggleWebhook'
        | 'RotateWebhook'
        | 'TestWebhook'
        | 'ReplayWebhook'
        | 'Attempts'
    }
  >
) {
  const workspaceSlug = model.flags.slug
  return Effect.gen(function* () {
    switch (operation._tag) {
      case 'CreateWebhook': {
        const result = yield* call(
          () =>
            Api.createWebhookEndpointServerFn({
              data: {
                workspaceSlug,
                url: model.webhooks.url,
                events: model.webhooks.events
              }
            }),
          m.webhook_create_failed()
        )
        return {
          _tag: 'Secret',
          secret: result.signingSecret,
          notice: m.webhook_created_copy_notice()
        } satisfies Result
      }
      case 'SaveWebhook': {
        yield* call(
          () =>
            Api.updateWebhookEndpointServerFn({
              data: {
                workspaceSlug,
                endpointId: operation.id,
                url: model.webhooks.url,
                events: model.webhooks.events
              }
            }),
          m.webhook_create_failed()
        )
        break
      }
      case 'ToggleWebhook': {
        yield* call(
          () =>
            Api.updateWebhookEndpointServerFn({
              data: {
                workspaceSlug,
                endpointId: operation.id,
                enabled: operation.enabled
              }
            }),
          operation.enabled ? m.webhook_create_failed() : m.endpoint_disable_failed()
        )
        return {
          _tag: 'Done',
          notice: operation.enabled ? m.common_enabled() : m.endpoint_disabled()
        } satisfies Result
      }
      case 'RotateWebhook': {
        const rotatedSecret = yield* call(
          () =>
            Api.rotateWebhookSecretServerFn({
              data: { workspaceSlug, endpointId: operation.id }
            }),
          m.secret_rotate_failed()
        )
        return {
          _tag: 'Secret',
          secret: rotatedSecret,
          notice: m.secret_rotated_copy_now()
        } satisfies Result
      }
      case 'TestWebhook': {
        yield* call(
          () =>
            Api.sendTestEventServerFn({
              data: { workspaceSlug, endpointId: operation.id }
            }),
          m.test_event_queue_failed()
        )
        break
      }
      case 'ReplayWebhook': {
        yield* call(
          () =>
            Api.replayWebhookDeliveryServerFn({
              data: { workspaceSlug, deliveryId: operation.id }
            }),
          m.replay_queue_failed()
        )
        break
      }
      case 'Attempts': {
        const attempts = yield* call(
          () =>
            Api.listWebhookDeliveryAttemptsServerFn({
              data: { workspaceSlug, deliveryId: operation.id }
            }),
          m.load_attempt_history_failed()
        )
        return { _tag: 'Attempts', attempts } satisfies Result
      }
      default: {
        break
      }
    }
    return { _tag: 'Done', notice: m.common_done() } satisfies Result
  })
}

const eventTypes = WEBHOOK_EVENT_TYPES
export function form(model: Model, h: H) {
  const selectedEvents = new Set(model.webhooks.events)
  return h.div(
    [h.Class('grid gap-4')],
    [
      h.p([], [m.create_endpoint_description()]),
      field(
        h,
        'webhook-url',
        m.endpoint_url(),
        model.webhooks.url,
        (value) => ({ _tag: 'WebhookField', value }),
        'url',
        false,
        m.endpoint_url_placeholder()
      ),
      h.fieldset(
        [],
        [
          h.legend([], [m.events()]),
          ...eventTypes.map((event) =>
            checkbox(
              h,
              event,
              selectedEvents.has(event),
              { _tag: 'WebhookEvent', event },
              model.pending
            )
          )
        ]
      ),
      action(
        h,
        model,
        model.webhooks.editing ? m.save_action() : m.webhook_create_action(),
        model.webhooks.editing
          ? { _tag: 'SaveWebhook', id: model.webhooks.editing }
          : { _tag: 'CreateWebhook' }
      ),
      secret(h, model),
      feedback(h, model)
    ]
  )
}
function diagnostic(model: Model, h: H, title: string, text: string) {
  return h.details(
    [h.Class('min-w-0 border bg-muted p-3')],
    [
      h.summary([h.Class('cursor-pointer')], [title]),
      h.div(
        [h.Class('flex gap-2 py-2')],
        [
          button(h, m.evidence_copy_named({ label: title }), { _tag: 'Copy', text }),
          h.button(
            [
              h.Type('button'),
              h.Attribute('aria-pressed', String(model.webhooks.wrap)),
              h.OnClick({ _tag: 'Wrap' })
            ],
            [m.evidence_wrap_lines()]
          )
        ]
      ),
      h.pre(
        [
          h.Tabindex(0),
          h.Class(
            `max-h-72 overflow-auto text-xs ${model.webhooks.wrap ? 'whitespace-pre-wrap break-all' : ''}`
          )
        ],
        [h.code([], [text])]
      )
    ]
  )
}
export function deliveries(model: Model, h: H) {
  if (model.page._tag !== 'webhooks') {
    return h.div([], [])
  }
  const endpoint = model.page.data.endpoints.find(
    (item) => item.id === query(model, 'record')
  )
  if (!endpoint) {
    return h.div([], [])
  }
  const canReplay = viewerCan(model.page.data.viewer, { webhook: ['replay'] })
  return h.div(
    [h.Class('grid min-w-0 gap-4')],
    [
      ...(endpoint.deliveries.length
        ? []
        : [
            h.p([], [m.empty_no_deliveries()]),
            h.p([], [m.no_deliveries_description()])
          ]),
      ...(canReplay
        ? [
            h.p(
              [],
              [m.test_event_description(), ' ', h.code([], ['webhook.test_event'])]
            ),
            action(h, model, m.send_test_event(), {
              _tag: 'TestWebhook',
              id: endpoint.id
            })
          ]
        : []),
      ...endpoint.deliveries.map((delivery) =>
        h.article(
          [h.Class('grid min-w-0 gap-3 border-b py-4')],
          [
            h.h3([], [delivery.eventType]),
            h.p([], [formatTimestampOr(delivery.lastAttemptAt, m.not_attempted())]),
            ...(delivery.nextAttemptAt
              ? [
                  h.p(
                    [],
                    [
                      m.webhook_next_attempt({
                        time: formatTimestampOr(delivery.nextAttemptAt, m.empty_value())
                      })
                    ]
                  )
                ]
              : []),
            ...(delivery.replayedFrom
              ? [h.p([], [m.replayed_from(), ' ', delivery.replayedFrom])]
              : []),
            ...(model.webhooks.delivery === delivery.id
              ? []
              : [
                  h.span(
                    [
                      h.Attribute(
                        'data-variant',
                        webhookDeliveryStatusVariant(delivery.status)
                      )
                    ],
                    [statusLabel(delivery.status)]
                  ),
                  ...(delivery.responseStatus === null
                    ? []
                    : [h.span([], [`HTTP ${delivery.responseStatus}`])])
                ]),
            model.webhooks.delivery === delivery.id
              ? button(
                  h,
                  m.hide_attempt_history(),
                  { _tag: 'HideAttempts' },
                  model.pending
                )
              : action(h, model, m.view_attempt_history(), {
                  _tag: 'Attempts',
                  id: delivery.id
                }),
            ...(canReplay &&
            ['failed', 'failed_permanent', 'dead_lettered'].includes(delivery.status)
              ? [
                  action(h, model, m.replay_action(), {
                    _tag: 'ReplayWebhook',
                    id: delivery.id
                  })
                ]
              : []),
            ...(model.webhooks.delivery === delivery.id
              ? [
                  diagnostic(
                    model,
                    h,
                    m.webhook_payload(),
                    JSON.stringify(delivery.payload, null, 2)
                  ),
                  ...(model.pendingAction?._tag === 'Attempts'
                    ? [h.output([], [m.loading_attempt_history()])]
                    : []),
                  ...(model.pendingAction?._tag !== 'Attempts' &&
                  model.failedAction?._tag === 'Attempts'
                    ? [
                        feedback(h, model),
                        action(h, model, m.retry_action(), {
                          _tag: 'Attempts',
                          id: delivery.id
                        })
                      ]
                    : []),
                  ...(model.pendingAction?._tag !== 'Attempts' &&
                  model.failedAction?._tag !== 'Attempts'
                    ? [
                        ...(model.webhooks.attempts.length === 0
                          ? [h.p([], [m.no_retained_attempts()])]
                          : []),
                        h.ol(
                          [h.Attribute('aria-label', m.attempt_history())],
                          model.webhooks.attempts.map((attempt) =>
                            h.li(
                              [h.Class('grid min-w-0 gap-2 py-3')],
                              [
                                h.span(
                                  [],
                                  [
                                    attempt.phase === 'terminal'
                                      ? m.terminal_outcome()
                                      : m.attempt_count({ count: attempt.attempts })
                                  ]
                                ),
                                h.span(
                                  [
                                    h.Attribute(
                                      'data-variant',
                                      webhookDeliveryStatusVariant(attempt.status)
                                    ),
                                    h.Class(
                                      webhookDeliveryStatusVariant(attempt.status) ===
                                        'destructive'
                                        ? 'text-destructive'
                                        : 'text-muted-foreground'
                                    )
                                  ],
                                  [statusLabel(attempt.status)]
                                ),
                                ...(attempt.responseStatus === null
                                  ? []
                                  : [h.span([], [`HTTP ${attempt.responseStatus}`])]),
                                ...(attempt.durationMs === null
                                  ? []
                                  : [h.span([], [`${attempt.durationMs} ms`])]),
                                ...(attempt.failureReason
                                  ? [h.p([], [attempt.failureReason])]
                                  : []),
                                ...(attempt.requestHeaders === null &&
                                attempt.responseBody === null
                                  ? []
                                  : [
                                      h.details(
                                        [],
                                        [
                                          h.summary([], [m.evidence_attempt_details()]),
                                          ...(attempt.requestHeaders === null
                                            ? []
                                            : [
                                                diagnostic(
                                                  model,
                                                  h,
                                                  m.webhook_request_headers(),
                                                  Object.entries(attempt.requestHeaders)
                                                    .map(
                                                      ([name, value]) =>
                                                        `${name}: ${value}`
                                                    )
                                                    .join('\n')
                                                )
                                              ]),
                                          ...(attempt.responseBody === null
                                            ? []
                                            : [
                                                diagnostic(
                                                  model,
                                                  h,
                                                  `${m.response_body()} ${m.webhook_bounded_excerpt()}`,
                                                  attempt.responseBody ||
                                                    m.empty_value()
                                                )
                                              ])
                                        ]
                                      )
                                    ])
                              ]
                            )
                          )
                        )
                      ]
                    : [])
                ]
              : [])
          ]
        )
      )
    ]
  )
}
export function view(model: Model, h: H) {
  if (model.page._tag !== 'webhooks') {
    return h.div([], [])
  }
  const data = model.page.data
  if (query(model, 'tab') === 'delivery') {
    return h.div(
      [h.Class('grid gap-6')],
      [
        heading(h, m.nav_webhook_endpoints(), m.webhooks_description()),
        tabs(h, model, [
          ['endpoints', m.endpoints_title()],
          ['delivery', m.webhook_delivery()]
        ]),
        tabPanel(h, 'delivery', [
          panel(h, m.webhook_delivery(), [
            ...(data.endpoints.length ? [] : [h.p([], [m.shell_chart_empty()])]),
            h.ul(
              [h.Class('grid gap-3')],
              data.endpoints.map((endpoint) =>
                h.li(
                  [h.Class('grid gap-2')],
                  [
                    h.p(
                      [h.Class('text-sm')],
                      [
                        new URL(endpoint.url).host,
                        ' · ',
                        m.shell_chart_delivered({
                          percent: `${endpoint.successRate}%`
                        }),
                        endpoint.enabled ? '' : ` · ${m.common_disabled()}`
                      ]
                    ),
                    ...(data.endpoints.length >= 3
                      ? [
                          h.div(
                            [
                              h.Attribute('aria-hidden', 'true'),
                              h.Class('h-2 bg-muted')
                            ],
                            [
                              h.div(
                                [
                                  h.Class(
                                    `h-full ${endpoint.successRate >= 95 ? 'bg-status-ok' : 'bg-status-warn'}`
                                  ),
                                  h.Attribute(
                                    'style',
                                    `width:${Math.min(100, Math.max(0, endpoint.successRate))}%`
                                  )
                                ],
                                []
                              )
                            ]
                          )
                        ]
                      : [])
                  ]
                )
              )
            )
          ])
        ])
      ]
    )
  }
  const fields = [
    { id: 'url', label: m.endpoint_url(), kind: 'text' as const },
    {
      id: 'status',
      label: m.common_status(),
      kind: 'select' as const,
      options: [
        { value: 'enabled', label: m.developer_list_enabled() },
        { value: 'disabled', label: m.developer_list_disabled() }
      ]
    },
    {
      id: 'successRate',
      label: m.developer_list_success_rate(),
      kind: 'number' as const
    }
  ]
  const rows = paged(
    model,
    'webhooks',
    fields,
    data.endpoints,
    (endpoint, key) => {
      if (key === 'status') {
        return endpoint.enabled ? 'enabled' : 'disabled'
      }
      if (key === 'successRate') {
        return endpoint.successRate
      }
      return endpoint.url
    },
    (endpoint) => `${endpoint.url} ${endpoint.events.join(' ')}`
  )
  return h.div(
    [h.Class('grid gap-6')],
    [
      heading(
        h,
        m.nav_webhook_endpoints(),
        m.webhooks_description(),
        viewerCan(data.viewer, { webhook: ['create'] })
          ? [button(h, m.register_endpoint(), { _tag: 'Open', dialog: 'webhook' })]
          : []
      ),
      tabs(h, model, [
        ['endpoints', m.endpoints_title()],
        ['delivery', m.webhook_delivery()]
      ]),
      tabPanel(h, 'endpoints', [
        ...(viewerCan(data.viewer, { webhook: ['create'] })
          ? []
          : [h.p([], [m.endpoint_register_denied()])]),
        listControls(h, model, 'webhooks', fields, m.developer_list_search_endpoints()),
        ...(rows.items.length
          ? []
          : [
              h.p(
                [],
                [
                  data.endpoints.length
                    ? m.developer_list_no_matching_endpoints()
                    : m.empty_no_endpoints()
                ]
              )
            ]),
        ...(viewerCan(data.viewer, { webhook: ['update'] })
          ? [h.p([], [m.webhook_secret_rotation_description()])]
          : []),
        h.ul(
          [],
          rows.items.map((endpoint) =>
            h.li(
              [h.Role('listitem'), h.Class('grid gap-4 border-b py-5')],
              [
                h.div(
                  [h.Class('flex flex-wrap justify-between gap-3')],
                  [
                    h.h2([h.Class('break-all font-medium')], [endpoint.url]),
                    h.span(
                      [],
                      [
                        `${endpoint.enabled ? m.common_enabled() : m.common_disabled()} · ${endpoint.successRate}%`
                      ]
                    )
                  ]
                ),
                h.p(
                  [h.Class('text-sm text-muted-foreground')],
                  [endpoint.events.join(', ')]
                ),
                h.div(
                  [h.Class('flex flex-wrap gap-2')],
                  viewerCan(data.viewer, { webhook: ['update'] })
                    ? [
                        actionMenu(
                          h,
                          `webhook-${endpoint.id}`,
                          m.members_more_actions({ name: endpoint.url }),
                          [
                            {
                              label: m.save_action(),
                              disabled: model.pending,
                              message: { _tag: 'EditWebhook', id: endpoint.id }
                            },
                            {
                              label: endpoint.enabled
                                ? m.disable_action()
                                : m.sso_connection_enable(),
                              disabled: model.pending,
                              message: endpoint.enabled
                                ? {
                                    _tag: 'Confirm',
                                    action: {
                                      _tag: 'ToggleWebhook',
                                      id: endpoint.id,
                                      enabled: false
                                    },
                                    title: m.disable_action()
                                  }
                                : {
                                    _tag: 'Perform',
                                    action: {
                                      _tag: 'ToggleWebhook',
                                      id: endpoint.id,
                                      enabled: true
                                    }
                                  }
                            },
                            {
                              label: m.rotate_secret(),
                              disabled: model.pending,
                              message: {
                                _tag: 'Perform',
                                action: { _tag: 'RotateWebhook', id: endpoint.id }
                              }
                            }
                          ]
                        )
                      ]
                    : []
                ),
                button(h, m.deliveries_count({ count: endpoint.deliveries.length }), {
                  _tag: 'Query',
                  key: 'record',
                  value: endpoint.id,
                  replace: false
                }),
                ...(model.failedAction &&
                'id' in model.failedAction &&
                model.failedAction.id === endpoint.id
                  ? [feedback(h, model)]
                  : []),
                ...(model.dialog === 'deliveries'
                  ? []
                  : [
                      h.details(
                        [],
                        [
                          h.summary(
                            [h.Class('cursor-pointer')],
                            [m.deliveries_count({ count: endpoint.deliveries.length })]
                          ),
                          h.ul(
                            [],
                            endpoint.deliveries.map((delivery) =>
                              row(
                                h,
                                delivery.eventType,
                                `${statusLabel(delivery.status)} · ${m.webhook_attempt_count({ count: delivery.attempts })} · HTTP ${delivery.responseStatus ?? '—'}`,
                                [
                                  action(h, model, m.attempt_history(), {
                                    _tag: 'Attempts',
                                    id: delivery.id
                                  }),
                                  ...(viewerCan(data.viewer, { webhook: ['replay'] }) &&
                                  [
                                    'failed',
                                    'failed_permanent',
                                    'dead_lettered'
                                  ].includes(delivery.status)
                                    ? [
                                        action(
                                          h,
                                          model,
                                          m.replay_action(),
                                          { _tag: 'ReplayWebhook', id: delivery.id },
                                          true
                                        )
                                      ]
                                    : []),
                                  ...(viewerCan(data.viewer, { assistant: ['read'] })
                                    ? [
                                        link(
                                          h,
                                          `${href(model, '/assistant')}?deliveryId=${encodeURIComponent(delivery.id)}`,
                                          m.investigate_action()
                                        )
                                      ]
                                    : []),
                                  diagnostic(
                                    model,
                                    h,
                                    m.webhook_payload(),
                                    JSON.stringify(delivery.payload, null, 2)
                                  ),
                                  diagnostic(
                                    model,
                                    h,
                                    m.response_body(),
                                    delivery.responseBody ?? ''
                                  )
                                ]
                              )
                            )
                          )
                        ]
                      )
                    ])
              ]
            )
          )
        ),
        pagination(h, model, rows.pages),
        ...(model.webhooks.delivery && model.dialog !== 'deliveries'
          ? [
              panel(
                h,
                m.attempt_history(),
                model.webhooks.attempts.map((attempt) =>
                  h.article(
                    [h.Class('grid gap-2 border-b py-3')],
                    [
                      h.p(
                        [],
                        [
                          `${statusLabel(attempt.status)} · ${formatTimestampOr(attempt.attemptedAt, m.empty_value())} · ${attempt.durationMs ?? 0} ms · HTTP ${attempt.responseStatus ?? '—'}`
                        ]
                      ),
                      ...(attempt.failureReason
                        ? [h.p([], [attempt.failureReason])]
                        : []),
                      diagnostic(
                        model,
                        h,
                        m.webhook_request_headers(),
                        JSON.stringify(attempt.requestHeaders, null, 2)
                      ),
                      diagnostic(
                        model,
                        h,
                        m.response_body(),
                        attempt.responseBody ?? ''
                      )
                    ]
                  )
                )
              )
            ]
          : []),
        secret(h, model),
        ...(model.failedAction && 'id' in model.failedAction
          ? []
          : [feedback(h, model)])
      ])
    ]
  )
}
