import { Effect, Option, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { type Html, type HtmlBuilder } from 'foldkit/html'
import {
  applyTableView,
  isActiveTableFilter,
  operatorsForTableField,
  parseTableView,
  serializeTableView,
  tableFilterOperators,
  type TableViewField
} from '@/lib/table-view'
import { m } from '@b2b-saas-starter/i18n/messages'
import { inputClass } from '../shared/view'
import { button, field, text } from './ui'

const Filter = Schema.Struct({
  field: Schema.String,
  operator: Schema.Literals(tableFilterOperators),
  value: Schema.String
})
const Sort = Schema.Struct({
  field: Schema.String,
  direction: Schema.Literals(['asc', 'desc'])
})
const View = Schema.Struct({
  match: Schema.Literals(['all', 'any']),
  filters: Schema.Array(Filter),
  sorts: Schema.Array(Sort)
})
const Views = Schema.Record(Schema.String, Schema.String)
const decodeViews = Schema.decodeUnknownOption(Schema.fromJsonString(Views))
export const Model = Schema.Struct({
  key: Schema.String,
  view: View,
  search: Schema.String,
  page: Schema.Number,
  hidden: Schema.Array(Schema.String),
  fixedColumns: Schema.Array(Schema.String),
  columnSearch: Schema.String,
  optionSearch: Schema.Record(Schema.String, Schema.String)
})
export type Model = typeof Model.Type
export const Message = Schema.TaggedUnion({
  Search: { value: Schema.String },
  ColumnSearch: { value: Schema.String },
  OptionSearch: { field: Schema.String, value: Schema.String },
  Filter: { value: Filter },
  Match: { value: Schema.Literals(['all', 'any']) },
  Sort: { field: Schema.String },
  MoveSort: { index: Schema.Number },
  Hide: { field: Schema.String },
  Page: { value: Schema.Number },
  Reset: {},
  Persisted: {}
})
export type Message = typeof Message.Type
function readViews(search: string) {
  const value = new URLSearchParams(search).get('tableViews')
  if (!value || value.length > 32_768) {
    return {}
  }
  return Option.getOrElse(decodeViews(value), () => ({}))
}
export function init(
  key: string,
  search: string,
  fields: ReadonlyArray<TableViewField & { readonly enableHiding?: boolean }>
): Model {
  return {
    key,
    view: parseTableView(readViews(search)[key], fields),
    search: '',
    page: 0,
    hidden: [],
    fixedColumns: fields.flatMap((column) =>
      column.enableHiding === false ? [column.id] : []
    ),
    columnSearch: '',
    optionSearch: {}
  }
}
const Persist = Command.define('AccountTable.Persist', {
  args: { model: Model },
  messages: [Message.cases.Persisted],
  execute: ({ model }) =>
    Effect.sync(() => {
      const url = new URL(window.location.href)
      const views = readViews(url.search)
      const serialized = serializeTableView(model.view)
      const next = Object.fromEntries(
        Object.entries(views).filter(([key]) => key !== model.key)
      )
      if (serialized) {
        next[model.key] = serialized
      }
      if (Object.keys(next).length) {
        url.searchParams.set('tableViews', JSON.stringify(next))
      } else {
        url.searchParams.delete('tableViews')
      }
      window.history.pushState(null, '', url)
      return Message.cases.Persisted.make({})
    })
})
export function update(model: Model, message: Message): Update.Return<Model, Message> {
  let next = model
  switch (message._tag) {
    case 'ColumnSearch': {
      return { model: { ...model, columnSearch: message.value } }
    }
    case 'OptionSearch': {
      return {
        model: {
          ...model,
          optionSearch: { ...model.optionSearch, [message.field]: message.value }
        }
      }
    }
    case 'Search': {
      return { model: { ...model, search: message.value, page: 0 } }
    }
    case 'Filter': {
      next = {
        ...model,
        page: 0,
        view: {
          ...model.view,
          filters: [
            ...model.view.filters.filter(
              (filter) => filter.field !== message.value.field
            ),
            message.value
          ]
        }
      }
      break
    }
    case 'Match': {
      next = { ...model, page: 0, view: { ...model.view, match: message.value } }
      break
    }
    case 'Sort': {
      const old = model.view.sorts.find((sort) => sort.field === message.field)
      let sorts: typeof model.view.sorts
      if (old?.direction === 'desc') {
        sorts = model.view.sorts.filter((sort) => sort.field !== message.field)
      } else if (old) {
        sorts = model.view.sorts.map((sort) =>
          sort.field === message.field ? { ...sort, direction: 'desc' as const } : sort
        )
      } else {
        sorts = [...model.view.sorts, { field: message.field, direction: 'asc' }]
      }
      next = {
        ...model,
        page: 0,
        view: {
          ...model.view,
          sorts
        }
      }
      break
    }
    case 'MoveSort': {
      const sorts = [...model.view.sorts]
      const current = sorts[message.index]
      const previous = sorts[message.index - 1]
      if (current && previous) {
        sorts[message.index - 1] = current
        sorts[message.index] = previous
      }
      next = { ...model, view: { ...model.view, sorts } }
      break
    }
    case 'Hide': {
      if (model.fixedColumns.includes(message.field)) {
        return { model }
      }
      return {
        model: {
          ...model,
          hidden: model.hidden.includes(message.field)
            ? model.hidden.filter((id) => id !== message.field)
            : [...model.hidden, message.field]
        }
      }
    }
    case 'Page': {
      return { model: { ...model, page: Math.max(0, message.value) } }
    }
    case 'Reset': {
      next = {
        ...model,
        page: 0,
        search: '',
        view: { match: 'all', filters: [], sorts: [] }
      }
      break
    }
    case 'Persisted': {
      return { model }
    }
  }
  return { model: next, commands: [Persist({ model: next })] }
}
export type Column<T, M> = {
  readonly enableHiding?: boolean
  readonly value: (row: T) => string | number | boolean | null
  readonly cell?: (row: T, h: HtmlBuilder<M>) => Html
} & TableViewField
function inputType(kind: TableViewField['kind']): string {
  if (kind === 'date' || kind === 'number') {
    return kind
  }
  return 'text'
}
function operatorLabel(operator: typeof Filter.Type.operator): string {
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
export function view<T, M>(
  model: Model,
  h: HtmlBuilder<M>,
  wrap: (message: Message) => NoInfer<M>,
  rows: ReadonlyArray<T>,
  columns: ReadonlyArray<Column<T, M>>,
  label: string,
  empty: string,
  pageSize?: number,
  actions?: (row: T) => Html,
  serverFiltered = false
): Html {
  const filtered = serverFiltered
    ? rows
    : applyTableView(
        rows.filter(
          (row) =>
            !model.search ||
            columns.some((column) =>
              String(column.value(row) ?? '')
                .toLocaleLowerCase()
                .includes(model.search.toLocaleLowerCase())
            )
        ),
        model.view,
        (row, id) => columns.find((column) => column.id === id)?.value(row)
      )
  const size =
    pageSize === undefined ? Math.max(1, filtered.length) : Math.max(1, pageSize)
  const page = Math.min(model.page, Math.max(0, Math.ceil(filtered.length / size) - 1))
  const hidden = new Set(model.hidden)
  const visible = columns.filter(
    (column) => column.enableHiding === false || !hidden.has(column.id)
  )
  return h.div(
    [h.Class('grid min-w-0 gap-3')],
    [
      ...(serverFiltered
        ? []
        : [
            field(
              h,
              `${model.key}-search`,
              m.common_search(),
              model.search,
              (value) => wrap({ _tag: 'Search', value }),
              'search',
              false
            )
          ]),
      h.div(
        [h.Class('flex flex-wrap items-start gap-2')],
        columns.map((column) => {
          const filter = model.view.filters.find(
            (entry) => entry.field === column.id
          ) ?? {
            field: column.id,
            operator: operatorsForTableField(column)[0] ?? 'contains',
            value: ''
          }
          let summary = column.label
          if (filter.value) {
            const value =
              column.options?.find((option) => option.value === filter.value)?.label ??
              filter.value
            summary = `${column.label}: ${operatorLabel(filter.operator)} ${value}`
          } else if (
            filter.operator === 'isEmpty' ||
            filter.operator === 'isNotEmpty'
          ) {
            summary = `${column.label}: ${operatorLabel(filter.operator)}`
          }
          return h.details(
            [
              h.Class(
                'relative max-w-full border border-dashed border-input p-2 text-sm'
              )
            ],
            [
              h.summary([h.Class('cursor-pointer')], [summary]),
              h.div(
                [h.Class('grid max-w-full gap-2 py-3')],
                [
                  h.select(
                    [
                      h.AriaLabel(m.table_view_operator()),
                      h.Class(inputClass),
                      h.Value(filter.operator),
                      h.OnChange((value) => {
                        const operator =
                          tableFilterOperators.find(
                            (candidate) => candidate === value
                          ) ?? 'contains'
                        return wrap({ _tag: 'Filter', value: { ...filter, operator } })
                      })
                    ],
                    operatorsForTableField(column).map((operator) =>
                      h.option([h.Value(operator)], [operatorLabel(operator)])
                    )
                  ),
                  ...(column.kind === 'select'
                    ? [
                        field(
                          h,
                          `${model.key}-${column.id}-search`,
                          m.table_view_search_values(),
                          model.optionSearch[column.id] ?? '',
                          (value) =>
                            wrap({ _tag: 'OptionSearch', field: column.id, value }),
                          'search',
                          false
                        ),
                        h.select(
                          [
                            h.AriaLabel(column.label),
                            h.Class(inputClass),
                            h.Value(filter.value),
                            h.OnChange((value) =>
                              wrap({ _tag: 'Filter', value: { ...filter, value } })
                            )
                          ],
                          [
                            h.option([h.Value('')], ['—']),
                            ...(column.options ?? []).flatMap((option) =>
                              option.label
                                .toLocaleLowerCase()
                                .includes(
                                  (
                                    model.optionSearch[column.id] ?? ''
                                  ).toLocaleLowerCase()
                                )
                                ? [h.option([h.Value(option.value)], [option.label])]
                                : []
                            )
                          ]
                        )
                      ]
                    : [
                        field(
                          h,
                          `${model.key}-${column.id}`,
                          m.table_view_value(),
                          filter.value,
                          (value) =>
                            wrap({ _tag: 'Filter', value: { ...filter, value } }),
                          inputType(column.kind),
                          false
                        )
                      ])
                ]
              )
            ]
          )
        })
      ),
      h.div(
        [h.Class('flex flex-wrap gap-2')],
        [
          ...(model.view.filters.filter(isActiveTableFilter).length > 1
            ? [
                button(
                  h,
                  m.table_view_all(),
                  wrap({ _tag: 'Match', value: 'all' }),
                  model.view.match === 'all'
                ),
                button(
                  h,
                  m.table_view_any(),
                  wrap({ _tag: 'Match', value: 'any' }),
                  model.view.match === 'any'
                )
              ]
            : []),
          h.details(
            [],
            [
              h.summary([h.Class('cursor-pointer text-sm')], [m.table_view_columns()]),
              field(
                h,
                `${model.key}-columns-search`,
                m.table_view_search_columns(),
                model.columnSearch,
                (value) => wrap({ _tag: 'ColumnSearch', value }),
                'search',
                false
              ),
              ...columns.flatMap((column) => {
                if (
                  column.enableHiding === false ||
                  !column.label
                    .toLocaleLowerCase()
                    .includes(model.columnSearch.toLocaleLowerCase())
                ) {
                  return []
                }
                return [
                  h.label(
                    [h.Class('flex min-h-11 items-center gap-2 text-sm')],
                    [
                      h.input([
                        h.Type('checkbox'),
                        h.Checked(!hidden.has(column.id)),
                        h.OnClick(wrap({ _tag: 'Hide', field: column.id }))
                      ]),
                      column.label
                    ]
                  )
                ]
              })
            ]
          ),
          h.details(
            [],
            [
              h.summary(
                [h.Class('cursor-pointer text-sm')],
                [
                  model.view.sorts.length
                    ? `${m.table_view_sort()} · ${model.view.sorts.length}`
                    : m.table_view_sort()
                ]
              ),
              ...columns.map((column) =>
                button(h, column.label, wrap({ _tag: 'Sort', field: column.id }))
              ),
              ...model.view.sorts.map((sort, index) =>
                h.div(
                  [h.Class('flex items-center gap-2')],
                  [
                    text(
                      h,
                      `${columns.find((column) => column.id === sort.field)?.label ?? sort.field}: ${sort.direction}`
                    ),
                    button(
                      h,
                      m.table_view_move_up(),
                      wrap({ _tag: 'MoveSort', index }),
                      index === 0
                    )
                  ]
                )
              )
            ]
          ),
          button(h, m.table_view_clear_all(), wrap({ _tag: 'Reset' }))
        ]
      ),
      h.div(
        [h.Class('overflow-x-auto')],
        [
          h.table(
            [h.AriaLabel(label), h.Class('w-full text-left text-sm')],
            [
              h.thead(
                [],
                [
                  h.tr(
                    [],
                    [
                      ...visible.map((column) =>
                        h.th(
                          [h.Class('border-b border-border p-3 font-medium')],
                          [
                            button(
                              h,
                              column.label,
                              wrap({ _tag: 'Sort', field: column.id })
                            )
                          ]
                        )
                      ),
                      ...(actions
                        ? [h.th([h.Class('sr-only')], [m.common_actions()])]
                        : [])
                    ]
                  )
                ]
              ),
              h.tbody(
                [],
                filtered
                  .slice(page * size, (page + 1) * size)
                  .map((row) =>
                    h.tr(
                      [],
                      [
                        ...visible.map((column) =>
                          h.td(
                            [h.Class('border-b border-border p-3')],
                            [
                              column.cell
                                ? column.cell(row, h)
                                : String(column.value(row) ?? '—')
                            ]
                          )
                        ),
                        ...(actions
                          ? [
                              h.td(
                                [h.Class('border-b border-border p-3')],
                                [actions(row)]
                              )
                            ]
                          : [])
                      ]
                    )
                  )
              )
            ]
          )
        ]
      ),
      ...(filtered.length ? [] : [text(h, empty)]),
      ...(pageSize === undefined
        ? []
        : [
            h.div(
              [h.Class('flex flex-wrap items-center justify-end gap-3')],
              [
                text(
                  h,
                  `${page + 1} / ${Math.max(1, Math.ceil(filtered.length / size))}`
                ),
                button(
                  h,
                  m.shell_table_previous(),
                  wrap({ _tag: 'Page', value: page - 1 }),
                  page === 0
                ),
                button(
                  h,
                  m.shell_table_next(),
                  wrap({ _tag: 'Page', value: page + 1 }),
                  (page + 1) * size >= filtered.length
                )
              ]
            )
          ])
    ]
  )
}
