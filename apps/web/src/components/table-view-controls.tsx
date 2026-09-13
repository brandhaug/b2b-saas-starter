'use client'

import { useRef, useState, type RefObject } from 'react'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FilterIcon,
  ListFilterIcon,
  PlusIcon,
  XIcon
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  operatorsForTableField,
  type TableFilterOperator,
  type TableView,
  type TableViewField
} from '@/lib/table-view'
import { m } from '@b2b-saas-starter/i18n/messages'

type Props = {
  readonly fields: ReadonlyArray<TableViewField>
  readonly view: TableView
  readonly onChange: (view: TableView) => void
}

const operatorLabels = {
  contains: () => m.table_view_contains(),
  notContains: () => m.table_view_not_contains(),
  is: () => m.table_view_is(),
  isNot: () => m.table_view_is_not(),
  before: () => m.table_view_before(),
  after: () => m.table_view_after(),
  gt: () => m.table_view_greater_than(),
  lt: () => m.table_view_less_than(),
  isEmpty: () => m.table_view_is_empty(),
  isNotEmpty: () => m.table_view_is_not_empty()
} satisfies Record<TableFilterOperator, () => string>
const filterMatches = ['all', 'any'] satisfies ReadonlyArray<'all' | 'any'>

function fieldLabel(fields: ReadonlyArray<TableViewField>, id: string) {
  return fields.find((field) => field.id === id)?.label ?? id
}

export function TableViewControls({ fields, view, onChange }: Props) {
  const [open, setOpen] = useState<'filter' | 'sort' | null>(null)
  const [selectedFilter, setSelectedFilter] = useState(0)
  const filterFields = useRef<Array<HTMLButtonElement | null>>([])
  const active = view.filters.length + view.sorts.length
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      aria-label={m.table_view_controls()}
    >
      <Popover
        open={open === 'filter'}
        onOpenChange={(next) => setOpen(next ? 'filter' : null)}
      >
        <PopoverTrigger
          render={
            <Button variant="outline" size="xs" aria-expanded={open === 'filter'} />
          }
        >
          <FilterIcon data-icon="inline-start" /> {m.table_view_filter()}
          {view.filters.length > 0 ? ` · ${view.filters.length}` : ''}
        </PopoverTrigger>
        <PopoverContent
          aria-label={m.table_view_filter()}
          initialFocus={() => filterFields.current[selectedFilter] ?? true}
        >
          <FilterPanel
            fieldRefs={filterFields}
            fields={fields}
            view={view}
            onChange={onChange}
            close={() => setOpen(null)}
          />
        </PopoverContent>
      </Popover>
      <Popover
        open={open === 'sort'}
        onOpenChange={(next) => setOpen(next ? 'sort' : null)}
      >
        <PopoverTrigger
          render={
            <Button variant="outline" size="xs" aria-expanded={open === 'sort'} />
          }
        >
          <ListFilterIcon data-icon="inline-start" /> {m.table_view_sort()}
          {view.sorts.length > 0 ? ` · ${view.sorts.length}` : ''}
        </PopoverTrigger>
        <PopoverContent aria-label={m.table_view_sort()}>
          <SortPanel
            fields={fields}
            view={view}
            onChange={onChange}
            close={() => setOpen(null)}
          />
        </PopoverContent>
      </Popover>
      {active > 0 && (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            onChange({ ...view, match: 'all', filters: [], sorts: [] })
            setOpen(null)
          }}
        >
          {m.table_view_clear_all()}
        </Button>
      )}
      <div className="flex flex-wrap gap-1" aria-label={m.table_view_active_filters()}>
        {view.filters.map((filter, index) => (
          <span
            className="inline-flex items-center rounded-md bg-secondary"
            // Position-owned controlled rows keep focus while their values change.
            // oxlint-disable-next-line react/no-array-index-key, react-doctor/no-array-index-as-key
            key={index}
          >
            <Button
              variant="secondary"
              size="xs"
              aria-label={`${m.table_view_filter()} ${fieldLabel(fields, filter.field)}`}
              onClick={() => {
                setSelectedFilter(index)
                setOpen('filter')
                filterFields.current[index]?.focus()
              }}
            >
              {fieldLabel(fields, filter.field)} {operatorLabels[filter.operator]()}{' '}
              {fields
                .find((field) => field.id === filter.field)
                ?.options?.find((option) => option.value === filter.value)?.label ??
                (filter.value || '∅')}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`${m.table_view_remove_filter()} ${fieldLabel(fields, filter.field)}`}
              onClick={() =>
                onChange({
                  ...view,
                  filters: view.filters.filter((_, i) => i !== index)
                })
              }
            >
              <XIcon />
            </Button>
          </span>
        ))}
      </div>
    </div>
  )
}

function FilterPanel({
  fieldRefs,
  fields,
  view,
  onChange,
  close
}: Props & {
  readonly close: () => void
  readonly fieldRefs: RefObject<Array<HTMLButtonElement | null>>
}) {
  /* oxlint-disable react/no-array-index-key, react-doctor/no-array-index-as-key -- rows are position-owned controlled inputs; value keys remount and lose focus. */
  function updateFilter(index: number, change: Partial<TableView['filters'][number]>) {
    onChange({
      ...view,
      filters: view.filters.map((filter, i) =>
        i === index ? { ...filter, ...change } : filter
      )
    })
  }
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{m.table_view_filter()}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={m.common_close()}
          onClick={close}
        >
          <XIcon />
        </Button>
      </div>
      <fieldset className="flex gap-1" aria-label={m.table_view_match()}>
        {filterMatches.map((match) => (
          <Button
            key={match}
            size="xs"
            variant={view.match === match ? 'secondary' : 'ghost'}
            onClick={() => onChange({ ...view, match })}
          >
            {match === 'all' ? m.table_view_all() : m.table_view_any()}
          </Button>
        ))}
      </fieldset>
      {view.filters.map((filter, index) => {
        const field =
          fields.find((candidate) => candidate.id === filter.field) ?? fields[0]
        if (!field) {
          return null
        }
        const needsValue =
          filter.operator !== 'isEmpty' && filter.operator !== 'isNotEmpty'
        return (
          <div key={index} className="grid grid-cols-[1fr_1fr] gap-2">
            <Select
              items={fields.map((candidate) => ({
                value: candidate.id,
                label: candidate.label
              }))}
              value={field.id}
              onValueChange={(value) => {
                if (value) {
                  const nextField = fields.find((candidate) => candidate.id === value)
                  updateFilter(index, {
                    field: value,
                    operator: nextField ? defaultOperator(nextField) : 'contains',
                    value: ''
                  })
                }
              }}
            >
              <SelectTrigger
                ref={(element) => {
                  fieldRefs.current[index] = element
                }}
                aria-label={m.table_view_field()}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {fields.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              items={operatorsForTableField(field).map((operator) => ({
                value: operator,
                label: operatorLabels[operator]()
              }))}
              value={filter.operator}
              onValueChange={(value) =>
                value &&
                updateFilter(index, {
                  operator: value,
                  value:
                    value === 'isEmpty' || value === 'isNotEmpty' ? '' : filter.value
                })
              }
            >
              <SelectTrigger aria-label={m.table_view_operator()}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {operatorsForTableField(field).map((operator) => (
                    <SelectItem key={operator} value={operator}>
                      {operatorLabels[operator]()}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {needsValue &&
              (field.kind === 'select' ? (
                <Select
                  items={field.options ?? []}
                  value={filter.value}
                  onValueChange={(value) =>
                    value !== null && updateFilter(index, { value })
                  }
                >
                  <SelectTrigger
                    aria-label={m.table_view_value()}
                    className="col-span-2"
                  >
                    <SelectValue placeholder={m.table_view_choose_value()} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {(field.options ?? []).map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className="col-span-2"
                  type={inputType(field)}
                  aria-label={m.table_view_value()}
                  value={filter.value}
                  onChange={(event) =>
                    updateFilter(index, { value: event.target.value })
                  }
                />
              ))}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={m.table_view_remove_filter()}
              onClick={() =>
                onChange({
                  ...view,
                  filters: view.filters.filter((_, i) => i !== index)
                })
              }
            >
              <XIcon />
            </Button>
          </div>
        )
      })}
      <Button
        variant="outline"
        size="xs"
        onClick={() =>
          onChange({
            ...view,
            filters: [
              ...view.filters,
              {
                field: fields[0]?.id ?? '',
                operator: fields[0] ? defaultOperator(fields[0]) : 'contains',
                value: ''
              }
            ]
          })
        }
      >
        <PlusIcon data-icon="inline-start" /> {m.table_view_add_filter()}
      </Button>
    </div>
  )
}

/* oxlint-enable react/no-array-index-key, react-doctor/no-array-index-as-key */
function defaultOperator(field: TableViewField): TableFilterOperator {
  if (field.kind === 'select') {
    return 'is'
  }
  if (field.kind === 'date') {
    return 'after'
  }
  if (field.kind === 'number') {
    return 'gt'
  }
  return 'contains'
}

function inputType(field: TableViewField): 'date' | 'number' | 'text' {
  if (field.kind === 'date') {
    return 'date'
  }
  if (field.kind === 'number') {
    return 'number'
  }
  return 'text'
}

function SortPanel({
  fields,
  view,
  onChange,
  close
}: Props & { readonly close: () => void }) {
  /* oxlint-disable react/no-array-index-key, react-doctor/no-array-index-as-key -- rows are position-owned controlled inputs; value keys remount and lose focus. */
  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{m.table_view_sort()}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={m.common_close()}
          onClick={close}
        >
          <XIcon />
        </Button>
      </div>
      {view.sorts.map((sort, index) => (
        <div key={index} className="flex items-center gap-2">
          <Select
            items={fields.map((field) => ({ value: field.id, label: field.label }))}
            value={sort.field}
            onValueChange={(value) =>
              value &&
              onChange({
                ...view,
                sorts: view.sorts.map((item, i) =>
                  i === index ? { ...item, field: value } : item
                )
              })
            }
          >
            <SelectTrigger aria-label={m.table_view_field()} className="min-w-0 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {fields.map((field) => (
                  <SelectItem key={field.id} value={field.id}>
                    {field.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              onChange({
                ...view,
                sorts: view.sorts.map((item, i) =>
                  i === index
                    ? { ...item, direction: item.direction === 'asc' ? 'desc' : 'asc' }
                    : item
                )
              })
            }
          >
            {sort.direction === 'asc'
              ? m.table_view_ascending()
              : m.table_view_descending()}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={m.table_view_move_up()}
            disabled={index === 0}
            onClick={() => moveSort(view, onChange, index, -1)}
          >
            <ArrowUpIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={m.table_view_move_down()}
            disabled={index === view.sorts.length - 1}
            onClick={() => moveSort(view, onChange, index, 1)}
          >
            <ArrowDownIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={m.table_view_remove_sort()}
            onClick={() =>
              onChange({ ...view, sorts: view.sorts.filter((_, i) => i !== index) })
            }
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="xs"
        disabled={view.sorts.length >= fields.length}
        onClick={() =>
          onChange({
            ...view,
            sorts: [
              ...view.sorts,
              {
                field:
                  fields.find(
                    (field) => !view.sorts.some((sort) => sort.field === field.id)
                  )?.id ?? '',
                direction: 'asc'
              }
            ]
          })
        }
      >
        <PlusIcon data-icon="inline-start" /> {m.table_view_add_sort()}
      </Button>
    </div>
  )
}

function moveSort(
  view: TableView,
  onChange: (view: TableView) => void,
  index: number,
  offset: -1 | 1
) {
  const sorts = [...view.sorts]
  const target = index + offset
  const current = sorts[index]
  const replacement = sorts[target]
  if (!current || !replacement) {
    return
  }
  sorts[index] = replacement
  sorts[target] = current
  onChange({ ...view, sorts })
}
/* oxlint-enable react/no-array-index-key, react-doctor/no-array-index-as-key */
