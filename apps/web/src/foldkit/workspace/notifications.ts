import { m } from '@b2b-saas-starter/i18n/messages'
import { formatDateTime } from '@/lib/format-date'
import { type Model } from './model'
import { action, button, feedback, panel, query, select, type H } from './ui'

export function view(model: Model, h: H) {
  if (model.page._tag !== 'dashboard') {
    return h.div([], [])
  }
  const notifications = model.page.data.notifications
  const unread = notifications.flatMap((item) => (item.read ? [] : [item.id]))
  const rowFailure =
    model.failedAction?._tag === 'MarkRead' && model.failedAction.ids.length === 1
      ? model.failedAction.ids[0]
      : null
  const visible =
    query(model, 'filter') === 'unread'
      ? notifications.filter((item) => !item.read)
      : notifications
  return panel(h, m.notifications_title(), [
    h.div(
      [h.Class('flex flex-wrap items-end gap-3')],
      [
        select(
          h,
          m.workspace_notification_filter(),
          query(model, 'filter') || 'all',
          [
            ['all', m.workspace_notifications_all()],
            ['unread', m.workspace_notifications_unread()]
          ],
          (value) => ({ _tag: 'Query', key: 'filter', value, replace: false })
        ),
        action(h, model, m.common_refresh_notifications(), { _tag: 'Refresh' }),
        ...(unread.length
          ? [
              action(
                h,
                model,
                `${m.notifications_mark_all_read()} · ${m.notifications_unread_count({ count: unread.length })}`,
                {
                  _tag: 'MarkRead',
                  ids: unread
                }
              )
            ]
          : [])
      ]
    ),
    ...visible.map((item) =>
      h.article(
        [h.Role('listitem'), h.Class('grid gap-2 border-b py-3')],
        [
          h.h3([h.Class(item.read ? 'text-sm' : 'text-sm font-medium')], [item.title]),
          h.span([], [item.read ? m.common_read() : m.common_new()]),
          h.p([h.Class('text-sm text-muted-foreground')], [item.message]),
          h.time(
            [
              h.Attribute('datetime', item.createdAt),
              h.Class('text-xs text-muted-foreground')
            ],
            [formatDateTime(item.createdAt)]
          ),
          ...(item.read
            ? []
            : [
                button(
                  h,
                  m.notifications_mark_read({ title: item.title }),
                  { _tag: 'Perform', action: { _tag: 'MarkRead', ids: [item.id] } },
                  model.pending
                )
              ]),
          ...(rowFailure === item.id ? [feedback(h, model)] : [])
        ]
      )
    ),
    ...(visible.length
      ? []
      : [
          h.p([], [m.empty_all_caught_up()]),
          h.p([h.Class('text-sm text-muted-foreground')], [m.empty_no_notifications()])
        ]),
    ...(rowFailure === null && model.failedAction !== null ? [feedback(h, model)] : [])
  ])
}
