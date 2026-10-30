import { Option, Schema } from 'effect'
import {
  applyTableView,
  parseTableView,
  serializeTableView,
  operatorsForTableField,
  type TableFilterOperator,
  type TableViewField
} from '@/lib/table-view'
import { m } from '@b2b-saas-starter/i18n/messages'
import { type Model, type Message } from './model'
import { button, field, query, select, popoverClass, type H } from './ui'

const Views = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String))
const decodeViews = Schema.decodeUnknownOption(Views)
function operatorLabel(operator: TableFilterOperator): string {
  switch (operator) {
    case 'contains': {
      return m.table_view_contains()
    }
    case 'notContains': {
      return m.table_view_not_contains()
    }
    case 'is': {
      return m.table_view_is()
    }
    case 'isNot': {
      return m.table_view_is_not()
    }
    case 'before': {
      return m.table_view_before()
    }
    case 'after': {
      return m.table_view_after()
    }
    case 'gt': {
      return m.table_view_greater_than()
    }
    case 'lt': {
      return m.table_view_less_than()
    }
    case 'isEmpty': {
      return m.table_view_is_empty()
    }
    case 'isNotEmpty': {
      return m.table_view_is_not_empty()
    }
  }
}
function views(model: Model): Readonly<Record<string, string>> {
  return Option.getOrElse(decodeViews(query(model, 'tableViews')), () => ({}))
}
export function tableView(
  model: Model,
  key: string,
  fields: ReadonlyArray<TableViewField>
) {
  return parseTableView(
    key === 'audit' ? query(model, 'view') : views(model)[key],
    fields
  )
}
export function listControls(
  h: H,
  model: Model,
  key: string,
  fields: ReadonlyArray<TableViewField>,
  searchLabel: string
) {
  const view = tableView(model, key, fields)
  const searchKey = key === 'invitations' ? 'invitationQuery' : 'query'
  function changed(
    next: typeof view,
    replace = false,
    dismiss = ''
  ): Extract<Message, { _tag: 'Query' }> {
    if (key === 'audit') {
      return {
        _tag: 'Query',
        key: 'view',
        value: serializeTableView(next) ?? '',
        replace,
        dismiss
      }
    }
    const saved = { ...views(model), [key]: serializeTableView(next) ?? '' }
    return {
      _tag: 'Query',
      key: 'tableViews',
      value: JSON.stringify(saved),
      replace,
      dismiss
    }
  }
  return h.div(
    [
      h.Class('grid gap-3'),
      h.Role('group'),
      h.Attribute('aria-label', m.table_view_controls())
    ],
    [
      ...(searchLabel
        ? [
            field(
              h,
              `${key}-search`,
              searchLabel,
              query(model, searchKey),
              (value) => ({
                _tag: 'Query',
                key: searchKey,
                value,
                replace: true
              })
            )
          ]
        : []),
      h.div(
        [h.Class('flex flex-wrap items-start gap-2')],
        fields.map((spec) => {
          const id = `table-${key}-${spec.id}`
          const current = view.filters.find((entry) => entry.field === spec.id)
          const operators = operatorsForTableField(spec)
          const defaultOperator = spec.kind === 'text' ? 'contains' : 'is'
          const selectedOperator =
            current?.operator ??
            operators.find((operator) => operator === model.tableOperators[id]) ??
            defaultOperator
          function filter(value: string, operator = selectedOperator) {
            const filters = view.filters.filter((entry) => entry.field !== spec.id)
            if (
              value.length > 0 ||
              operator === 'isEmpty' ||
              operator === 'isNotEmpty'
            ) {
              filters.push({ field: spec.id, operator, value })
            }
            return changed(
              {
                ...view,
                filters
              },
              true,
              spec.kind === 'select' ? id : ''
            )
          }
          return h.div(
            [h.Class('relative max-w-full')],
            [
              h.button(
                [
                  h.Type('button'),
                  h.Id(`${id}-trigger`),
                  h.Attribute('popovertarget', id),
                  h.Attribute('aria-haspopup', 'dialog'),
                  h.OnClick({
                    _tag: 'TableOpen',
                    id,
                    operator: current?.operator ?? defaultOperator
                  }),
                  h.Class(
                    'cursor-pointer rounded-md border border-dashed px-3 py-2 text-sm'
                  )
                ],
                [current?.value ? `${spec.label}: ${current.value}` : spec.label]
              ),
              h.div(
                [
                  h.Role('dialog'),
                  h.Id(id),
                  h.Attribute('popover', 'auto'),
                  h.Tabindex(-1),
                  h.Attribute('autofocus', ''),
                  ...(model.tablePopover === id
                    ? [h.Attribute('aria-label', spec.label)]
                    : []),
                  h.Class(popoverClass)
                ],
                [
                  ...(spec.kind === 'select'
                    ? [
                        field(
                          h,
                          `${id}-search`,
                          m.table_view_search_values(),
                          model.tableSearch[id] ?? '',
                          (value) => ({ _tag: 'TableSearch', key: id, value })
                        ),
                        ...((spec.options ?? []).some((option) =>
                          `${option.label} ${option.value}`
                            .toLocaleLowerCase()
                            .includes(
                              (model.tableSearch[id] ?? '').trim().toLocaleLowerCase()
                            )
                        )
                          ? []
                          : [h.p([], [m.table_view_no_results()])]),
                        ...(spec.options ?? []).flatMap((option) => {
                          if (
                            !`${option.label} ${option.value}`
                              .toLocaleLowerCase()
                              .includes(
                                (model.tableSearch[id] ?? '').trim().toLocaleLowerCase()
                              )
                          ) {
                            return []
                          }
                          return [
                            h.label(
                              [h.Class('flex min-h-9 items-center gap-2')],
                              [
                                h.input([
                                  h.Type('radio'),
                                  h.Name(`${key}-${spec.id}`),
                                  h.Checked(current?.value === option.value),
                                  h.OnChange(() => filter(option.value))
                                ]),
                                option.label
                              ]
                            )
                          ]
                        })
                      ]
                    : [
                        select(
                          h,
                          m.table_view_operator(),
                          selectedOperator,
                          operators.map((operator) => [
                            operator,
                            operatorLabel(operator)
                          ]),
                          (value) => {
                            const operator =
                              operators.find((candidate) => candidate === value) ??
                              defaultOperator
                            const nextValue =
                              operator === 'isEmpty' || operator === 'isNotEmpty'
                                ? ''
                                : (current?.value ?? '')
                            return {
                              ...filter(nextValue, operator),
                              draftOperator: { id, operator }
                            }
                          }
                        ),
                        ...(selectedOperator === 'isEmpty' ||
                        selectedOperator === 'isNotEmpty'
                          ? []
                          : [
                              field(
                                h,
                                `${key}-${spec.id}-value`,
                                m.table_view_value(),
                                current?.value ?? '',
                                (value) => filter(value),
                                spec.kind === 'text' ? 'text' : spec.kind
                              )
                            ])
                      ]),
                  button(
                    h,
                    m.table_view_clear_filter(),
                    changed({
                      ...view,
                      filters: view.filters.filter((entry) => entry.field !== spec.id)
                    })
                  )
                ]
              )
            ]
          )
        })
      ),
      ...(view.filters.length >= 2
        ? [
            h.div(
              [
                h.Class('flex gap-2'),
                h.Role('group'),
                h.Attribute('aria-label', m.table_view_match())
              ],
              [
                button(h, m.table_view_all(), changed({ ...view, match: 'all' })),
                button(h, m.table_view_any(), changed({ ...view, match: 'any' }))
              ]
            )
          ]
        : []),
      h.div(
        [],
        [
          h.button(
            [
              h.Type('button'),
              h.Class('cursor-pointer rounded-md border px-3 py-2 text-sm'),
              h.Attribute('popovertarget', `table-${key}-sort`),
              h.Attribute('aria-haspopup', 'dialog')
            ],
            [m.table_view_sort()]
          ),
          h.div(
            [
              h.Role('dialog'),
              h.Id(`table-${key}-sort`),
              h.Attribute('popover', 'auto'),
              h.Tabindex(-1),
              h.Attribute('autofocus', ''),
              h.Attribute('aria-label', m.table_view_sort()),
              h.Class(popoverClass)
            ],
            [
              ...view.sorts.map((sort, index) =>
                h.div(
                  [h.Class('flex flex-wrap gap-2')],
                  [
                    select(
                      h,
                      m.table_view_field(),
                      sort.field,
                      fields.flatMap((spec) =>
                        spec.id === sort.field ||
                        !view.sorts.some((entry) => entry.field === spec.id)
                          ? [[spec.id, spec.label] as const]
                          : []
                      ),
                      (value) =>
                        changed({
                          ...view,
                          sorts: view.sorts.map((entry, i) =>
                            i === index ? { ...entry, field: value } : entry
                          )
                        })
                    ),
                    select(
                      h,
                      m.table_view_direction(),
                      sort.direction,
                      [
                        ['asc', m.table_view_ascending()],
                        ['desc', m.table_view_descending()]
                      ],
                      (value) =>
                        changed({
                          ...view,
                          sorts: view.sorts.map((entry, i) =>
                            i === index
                              ? {
                                  ...entry,
                                  direction: value === 'desc' ? 'desc' : 'asc'
                                }
                              : entry
                          )
                        })
                    ),
                    button(
                      h,
                      m.table_view_move_up(),
                      changed({
                        ...view,
                        sorts:
                          index === 0
                            ? view.sorts
                            : [
                                ...view.sorts.slice(0, index - 1),
                                sort,
                                ...view.sorts.slice(index - 1, index),
                                ...view.sorts.slice(index + 1)
                              ]
                      }),
                      index === 0
                    ),
                    button(
                      h,
                      m.table_view_move_down(),
                      changed({
                        ...view,
                        sorts: [
                          ...view.sorts.slice(0, index),
                          ...view.sorts.slice(index + 1, index + 2),
                          sort,
                          ...view.sorts.slice(index + 2)
                        ]
                      }),
                      index === view.sorts.length - 1
                    ),
                    button(
                      h,
                      m.action_remove(),
                      changed({
                        ...view,
                        sorts: view.sorts.filter((_, i) => i !== index)
                      })
                    )
                  ]
                )
              ),
              button(
                h,
                m.table_view_add_sort(),
                changed({
                  ...view,
                  sorts: [
                    ...view.sorts,
                    {
                      field:
                        fields.find(
                          (spec) => !view.sorts.some((sort) => sort.field === spec.id)
                        )?.id ??
                        fields[0]?.id ??
                        '',
                      direction: 'asc'
                    }
                  ]
                }),
                view.sorts.length >= fields.length
              )
            ]
          )
        ]
      ),
      ...(view.filters.length + view.sorts.length > 0 ||
      query(model, searchKey) ||
      (key === 'audit' &&
        ['actor', 'eventType', 'since', 'until', 'cursor'].some((name) =>
          query(model, name)
        ))
        ? [
            button(h, m.table_view_clear_all(), {
              _tag: 'ClearList',
              key,
              tableViews:
                key === 'audit'
                  ? ''
                  : JSON.stringify(
                      Object.fromEntries(
                        Object.entries(views(model)).filter(([name]) => name !== key)
                      )
                    )
            })
          ]
        : [])
    ]
  )
}
export function paged<A>(
  model: Model,
  key: string,
  fields: ReadonlyArray<TableViewField>,
  rows: ReadonlyArray<A>,
  value: (row: A, key: string) => string | number | boolean | null | undefined,
  text: (row: A) => string
) {
  const queryText = query(
    model,
    key === 'invitations' ? 'invitationQuery' : 'query'
  ).toLocaleLowerCase()
  const filtered = applyTableView(
    rows.filter((row) => text(row).toLocaleLowerCase().includes(queryText)),
    tableView(model, key, fields),
    value
  )
  const pages = Math.max(1, Math.ceil(filtered.length / 20))
  const page = Math.min(
    pages,
    Math.max(1, Number.parseInt(query(model, 'page'), 10) || 1)
  )
  return { items: filtered.slice((page - 1) * 20, page * 20), pages }
}
export function pagination(h: H, model: Model, pages: number) {
  const page = Math.min(
    pages,
    Math.max(1, Number.parseInt(query(model, 'page'), 10) || 1)
  )
  return h.div(
    [h.Class('flex items-center justify-between gap-3')],
    [
      h.span([], [m.developer_list_page({ page, pages })]),
      button(
        h,
        m.developer_list_previous(),
        {
          _tag: 'Query',
          key: 'page',
          value: page === 2 ? '' : String(page - 1),
          replace: false
        },
        page === 1
      ),
      button(
        h,
        m.developer_list_next(),
        { _tag: 'Query', key: 'page', value: String(page + 1), replace: false },
        page === pages
      )
    ]
  )
}
