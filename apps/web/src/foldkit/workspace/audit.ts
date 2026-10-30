import { m } from '@b2b-saas-starter/i18n/messages'
import { auditActorTypeLabel, auditEventLabel } from '@/lib/audit-labels'
import { formatDateTime } from '@/lib/format-date'
import { type Model } from './model'
import { button, feedback, field, heading, query, type H } from './ui'
import { listControls, tableView } from './table'
import { auditViewFields } from '@/lib/audit-search'

export function detail(model: Model, h: H) {
  if (model.page._tag !== 'audit') {
    return h.div([], [])
  }
  const event = model.page.data.selectedEvent
  if (model.pending) {
    return h.p([h.Role('status')], [m.common_loading()])
  }
  if (model.error) {
    return h.div(
      [h.Class('grid gap-3')],
      [
        h.h3([h.Class('text-lg font-semibold')], [m.audit_unavailable()]),
        feedback(h, model),
        button(h, m.try_again(), { _tag: 'Perform', action: { _tag: 'Refresh' } })
      ]
    )
  }
  return h.div(
    [h.Class('grid gap-4')],
    event
      ? [
          h.p([], [m.audit_event_description()]),
          h.dl(
            [h.Class('grid gap-3 text-sm')],
            [
              [m.event_id_label(), event.id],
              [m.event_type_label(), auditEventLabel(event.eventType)],
              [m.actor_label(), event.actor],
              [m.actor_type_label(), auditActorTypeLabel(event.actorType)],
              [m.actor_user_id_label(), event.actorUserId ?? '—'],
              [m.target_type_label(), event.targetType],
              [m.target_id_label(), event.targetId ?? '—'],
              [m.time_label(), event.createdAt]
            ].map(([label, value]) =>
              h.div(
                [h.Class('grid gap-1')],
                [
                  h.dt([h.Class('text-muted-foreground')], [label ?? '']),
                  h.dd([h.Class('break-all')], [value ?? ''])
                ]
              )
            )
          ),
          h.h3([], [m.audit_metadata()]),
          h.p([], [m.audit_metadata_description()]),
          h.pre(
            [h.Class('whitespace-pre-wrap break-words')],
            [JSON.stringify(event.metadata, null, 2)]
          ),
          ...(Object.keys(event.metadata).length === 0
            ? [h.p([], [m.audit_no_metadata()])]
            : [])
        ]
      : [h.h3([], [m.empty_event_not_found()]), h.p([], [m.mcp_event_unavailable()])]
  )
}
export function view(model: Model, h: H) {
  if (model.page._tag !== 'audit') {
    return h.div([], [])
  }
  const data = model.page.data
  const filtered =
    ['actor', 'eventType', 'since', 'until', 'cursor'].some((key) =>
      query(model, key)
    ) || tableView(model, 'audit', auditViewFields()).filters.length > 0
  return h.div(
    [h.Class('grid gap-6')],
    [
      heading(h, m.nav_audit_trail(), m.audit_trail_description()),
      h.p([], [m.audit_events_description()]),
      ...(data.events.length
        ? []
        : [
            h.p([], [filtered ? m.empty_no_events_filters() : m.empty_no_events()]),
            h.p([], [filtered ? m.audit_widen_or_clear() : m.audit_actions_appear()])
          ]),
      h.div(
        [h.Class('flex flex-wrap gap-2')],
        (['actor', 'eventType', 'since', 'until'] as const).flatMap((key) => {
          const value = query(model, key)
          if (!value) {
            return []
          }
          let label = `${m.when_label()} ${key === 'since' ? '≥' : '≤'} ${value}`
          if (key === 'actor') {
            label = `${m.actor_label()} ${data.members.find((member) => member.id === value)?.name ?? value}`
          }
          if (key === 'eventType') {
            label = `${m.event_type_label()} ${auditEventLabel(value)}`
          }
          return [
            button(h, `${m.action_remove()} ${label}`, {
              _tag: 'Query',
              key,
              value: '',
              replace: false
            })
          ]
        })
      ),
      listControls(
        h,
        model,
        'audit',
        auditViewFields().map((spec) =>
          spec.id === 'actorUserId'
            ? {
                id: spec.id,
                label: spec.label,
                kind: 'select' as const,
                options: data.members.map((member) => ({
                  value: member.id,
                  label: member.name
                }))
              }
            : spec
        ),
        ''
      ),
      h.div(
        [h.Class('grid gap-3 sm:grid-cols-2 lg:grid-cols-4')],
        [
          field(
            h,
            'audit-event-type',
            m.event_type_label(),
            query(model, 'eventType'),
            (value) => ({ _tag: 'Query', key: 'eventType', value, replace: true })
          ),
          field(h, 'audit-actor', m.actor_label(), query(model, 'actor'), (value) => ({
            _tag: 'Query',
            key: 'actor',
            value,
            replace: true
          })),
          field(
            h,
            'audit-since',
            `${m.when_label()} ≥`,
            query(model, 'since'),
            (value) => ({ _tag: 'Query', key: 'since', value, replace: true }),
            'date'
          ),
          field(
            h,
            'audit-until',
            `${m.when_label()} ≤`,
            query(model, 'until'),
            (value) => ({ _tag: 'Query', key: 'until', value, replace: true }),
            'date'
          )
        ]
      ),
      h.div(
        [h.Class('overflow-x-auto')],
        [
          h.table(
            [
              h.Class('w-full text-left text-sm'),
              h.Attribute('aria-label', m.audit_table_label())
            ],
            [
              h.thead(
                [],
                [
                  h.tr(
                    [],
                    [m.event_type_label(), m.actor_label(), m.time_label()].map(
                      (label) => h.th([h.Class('border-b p-3 font-medium')], [label])
                    )
                  )
                ]
              ),
              h.tbody(
                [],
                data.events.map((event) => {
                  const url = new URL(model.url)
                  url.searchParams.set('event', event.id)
                  return h.tr(
                    [],
                    [
                      h.td(
                        [h.Class('border-b p-3')],
                        [
                          h.a(
                            [
                              h.Href(url.pathname + url.search),
                              h.Id(`audit-event-${event.id}`),
                              h.Class(
                                'inline-flex min-h-11 items-center underline-offset-4 hover:underline'
                              ),
                              h.OnClick(
                                {
                                  _tag: 'Query',
                                  key: 'event',
                                  value: event.id,
                                  replace: false
                                },
                                { defaultAction: 'Prevent', propagation: 'Stop' }
                              )
                            ],
                            [
                              m.inspect_audit_event({
                                event: auditEventLabel(event.eventType),
                                time: formatDateTime(event.createdAt)
                              })
                            ]
                          )
                        ]
                      ),
                      h.td(
                        [h.Class('border-b p-3')],
                        [event.actor, ' ', auditActorTypeLabel(event.actorType)]
                      ),
                      h.td([h.Class('border-b p-3')], [formatDateTime(event.createdAt)])
                    ]
                  )
                })
              )
            ]
          )
        ]
      ),
      ...(data.nextCursor
        ? [
            button(
              h,
              m.developer_list_next(),
              { _tag: 'Query', key: 'cursor', value: data.nextCursor, replace: false },
              model.pending
            )
          ]
        : []),
      feedback(h, model)
    ]
  )
}
