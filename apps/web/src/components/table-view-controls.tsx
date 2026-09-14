'use client'

import { useState } from 'react'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ListFilterIcon,
  PlusCircleIcon,
  PlusIcon,
  XIcon
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
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

export function TableViewControls({ fields, view, onChange }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const activeCount = view.filters.length + view.sorts.length

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      aria-label={m.table_view_controls()}
    >
      {fields.map((field) => {
        const id = `filter:${field.id}`
        const shared = {
          field,
          view,
          onChange,
          open: open === id,
          onOpenChange: (next: boolean) => setOpen(next ? id : null)
        }
        return field.kind === 'select' ? (
          <FacetFilter key={field.id} {...shared} />
        ) : (
          <FieldFilter key={field.id} {...shared} />
        )
      })}
      {view.filters.length >= 2 && <MatchControl view={view} onChange={onChange} />}
      <SortControl
        fields={fields}
        view={view}
        onChange={onChange}
        open={open === 'sort'}
        onOpenChange={(next) => setOpen(next ? 'sort' : null)}
      />
      {activeCount > 0 && (
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
    </div>
  )
}

type FilterControlProps = Omit<Props, 'fields'> & {
  readonly field: TableViewField
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

function FacetFilter({
  field,
  view,
  onChange,
  open,
  onOpenChange
}: FilterControlProps) {
  const [query, setQuery] = useState('')
  const active = view.filters.find((filter) => filter.field === field.id)
  const selected = active?.operator === 'is' ? active.value : undefined
  const valueLabel = field.options?.find((option) => option.value === selected)?.label
  const activeLabel = active
    ? `${operatorLabels[active.operator]()}${active.value ? ` ${valueLabel ?? active.value}` : ''}`
    : undefined
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const options = (field.options ?? []).filter((option) =>
    `${option.label} ${option.value}`.toLocaleLowerCase().includes(normalizedQuery)
  )

  function setSelected(value: string | undefined) {
    const filters = view.filters.filter((filter) => filter.field !== field.id)
    onChange({
      ...view,
      filters:
        value === undefined
          ? filters
          : [...filters, { field: field.id, operator: 'is', value }]
    })
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery('')
        }
        onOpenChange(next)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            className="border-dashed"
            aria-expanded={open}
            aria-label={
              activeLabel === undefined ? field.label : `${field.label}: ${activeLabel}`
            }
          />
        }
      >
        <PlusCircleIcon data-icon="inline-start" />
        {field.label}
        {activeLabel && (
          <span className="ml-0.5 max-w-32 truncate border-l border-border pl-1.5">
            {activeLabel}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" aria-label={field.label}>
        <div className="border-b border-border p-2">
          <Input
            placeholder={m.table_view_search_values()}
            aria-label={m.table_view_search_values()}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8"
          />
        </div>
        <RadioGroup
          aria-label={field.label}
          value={selected ?? ''}
          onValueChange={(value) => {
            setSelected(value)
            onOpenChange(false)
          }}
          className="max-h-75 gap-0 overflow-y-auto p-1"
        >
          {options.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm">{m.table_view_no_results()}</p>
          ) : (
            options.map((option) => {
              return (
                <Label
                  key={option.value}
                  className="focus-within:ring-ring flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-sm hover:bg-muted/50 focus-within:ring-2 max-md:h-11"
                >
                  <RadioGroupItem value={option.value} />
                  {option.label}
                </Label>
              )
            })
          )}
        </RadioGroup>
        {active !== undefined && (
          <div className="border-t border-border p-1">
            <Button
              variant="ghost"
              size="xs"
              className="w-full justify-start"
              onClick={() => setSelected(undefined)}
            >
              {m.table_view_clear_filter()}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function FieldFilter({
  field,
  view,
  onChange,
  open,
  onOpenChange
}: FilterControlProps) {
  const [draftOperator, setDraftOperator] = useState<TableFilterOperator>(() =>
    defaultOperator(field)
  )
  const active = view.filters.find((filter) => filter.field === field.id)
  const operator = active?.operator ?? draftOperator
  const value = active?.value ?? ''
  const operatorNeedsValue = operator !== 'isEmpty' && operator !== 'isNotEmpty'

  function setFilter(nextOperator: TableFilterOperator, nextValue: string) {
    const filters = view.filters.filter((filter) => filter.field !== field.id)
    const isActive =
      nextOperator === 'isEmpty' ||
      nextOperator === 'isNotEmpty' ||
      nextValue.length > 0
    onChange({
      ...view,
      filters: isActive
        ? [...filters, { field: field.id, operator: nextOperator, value: nextValue }]
        : filters
    })
  }

  const activeLabel = active
    ? `${operatorLabels[active.operator]()}${active.value ? ` ${active.value}` : ''}`
    : undefined

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraftOperator(active?.operator ?? defaultOperator(field))
        }
        onOpenChange(next)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            className="border-dashed"
            aria-expanded={open}
            aria-label={
              activeLabel === undefined ? field.label : `${field.label}: ${activeLabel}`
            }
          />
        }
      >
        <PlusCircleIcon data-icon="inline-start" />
        {field.label}
        {activeLabel && (
          <span className="ml-0.5 max-w-40 truncate border-l border-border pl-1.5">
            {activeLabel}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80" aria-label={field.label}>
        <div className="flex items-center gap-2">
          <Select
            items={operatorsForTableField(field).map((item) => ({
              value: item,
              label: operatorLabels[item]()
            }))}
            value={operator}
            onValueChange={(next) => {
              if (next) {
                const nextValue =
                  next === 'isEmpty' || next === 'isNotEmpty' ? '' : value
                setDraftOperator(next)
                if (active || next === 'isEmpty' || next === 'isNotEmpty') {
                  setFilter(next, nextValue)
                }
              }
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={m.table_view_operator()}
              className="min-w-0 flex-1"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {operatorsForTableField(field).map((item) => (
                  <SelectItem key={item} value={item}>
                    {operatorLabels[item]()}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {operatorNeedsValue && (
            <Input
              type={inputType(field)}
              aria-label={m.table_view_value()}
              value={value}
              onChange={(event) => setFilter(operator, event.target.value)}
              className="min-w-0 flex-1"
            />
          )}
          {active && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`${m.table_view_remove_filter()} ${field.label}`}
              onClick={() => {
                setDraftOperator(defaultOperator(field))
                setFilter(defaultOperator(field), '')
              }}
            >
              <XIcon />
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function MatchControl({ view, onChange }: Pick<Props, 'view' | 'onChange'>) {
  return (
    <fieldset className="inline-flex rounded-md border border-input bg-input/30 p-0.5">
      <legend className="sr-only">{m.table_view_match()}</legend>
      {filterMatches.map((match) => (
        <Button
          key={match}
          variant={view.match === match ? 'secondary' : 'ghost'}
          size="xs"
          className="h-7 rounded-sm border-0 px-2 max-md:h-10"
          aria-pressed={view.match === match}
          onClick={() => onChange({ ...view, match })}
        >
          {match === 'all' ? m.table_view_all() : m.table_view_any()}
        </Button>
      ))}
    </fieldset>
  )
}

function SortControl({
  fields,
  view,
  onChange,
  open,
  onOpenChange
}: Props & {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            aria-expanded={open}
            aria-label={`${m.table_view_sort()}${view.sorts.length > 0 ? ` · ${view.sorts.length}` : ''}`}
          />
        }
      >
        <ListFilterIcon data-icon="inline-start" />
        {m.table_view_sort()}
        {view.sorts.length > 0 && (
          <span className="ml-0.5 inline-flex min-w-4 items-center justify-center rounded-sm bg-secondary px-1 text-xs tabular-nums">
            {view.sorts.length}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-96" aria-label={m.table_view_sort()}>
        <SortPanel fields={fields} view={view} onChange={onChange} />
      </PopoverContent>
    </Popover>
  )
}

function SortPanel({ fields, view, onChange }: Props) {
  /* oxlint-disable react/no-array-index-key, react-doctor/no-array-index-as-key -- sort rows are position-owned controls; value keys remount their selects. */
  return (
    <div className="flex flex-col gap-2">
      {view.sorts.map((sort, index) => {
        const sortFields = fields.filter(
          (field) =>
            field.id === sort.field ||
            !view.sorts.some((candidate) => candidate.field === field.id)
        )
        return (
          <div key={index} className="grid grid-cols-2 items-center gap-1 sm:flex">
            <Select
              items={sortFields.map((field) => ({
                value: field.id,
                label: field.label
              }))}
              value={sort.field}
              onValueChange={(field) => {
                if (field) {
                  onChange({
                    ...view,
                    sorts: view.sorts.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, field } : item
                    )
                  })
                }
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label={m.table_view_field()}
                className="min-w-0 flex-1"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {sortFields.map((field) => (
                    <SelectItem key={field.id} value={field.id}>
                      {field.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              items={[
                { value: 'asc', label: m.table_view_ascending() },
                { value: 'desc', label: m.table_view_descending() }
              ]}
              value={sort.direction}
              onValueChange={(direction) => {
                if (direction === 'asc' || direction === 'desc') {
                  onChange({
                    ...view,
                    sorts: view.sorts.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, direction } : item
                    )
                  })
                }
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label={m.table_view_direction()}
                className="w-full sm:w-32"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="asc">{m.table_view_ascending()}</SelectItem>
                  <SelectItem value="desc">{m.table_view_descending()}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <div className="col-span-2 flex justify-end gap-1 sm:contents">
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
                  onChange({
                    ...view,
                    sorts: view.sorts.filter((_, itemIndex) => itemIndex !== index)
                  })
                }
              >
                <XIcon />
              </Button>
            </div>
          </div>
        )
      })}
      <Button
        variant="ghost"
        size="xs"
        className="self-start"
        disabled={view.sorts.length >= fields.length}
        onClick={() => {
          const field = fields.find(
            (candidate) => !view.sorts.some((sort) => sort.field === candidate.id)
          )
          if (field) {
            onChange({
              ...view,
              sorts: [...view.sorts, { field: field.id, direction: 'asc' }]
            })
          }
        }}
      >
        <PlusIcon data-icon="inline-start" />
        {m.table_view_add_sort()}
      </Button>
    </div>
  )
  /* oxlint-enable react/no-array-index-key, react-doctor/no-array-index-as-key */
}

function defaultOperator(field: TableViewField): TableFilterOperator {
  if (field.kind === 'date') {
    return 'after'
  }
  if (field.kind === 'number') {
    return 'gt'
  }
  return field.kind === 'select' ? 'is' : 'contains'
}

function inputType(field: TableViewField): 'date' | 'number' | 'text' {
  if (field.kind === 'date') {
    return 'date'
  }
  return field.kind === 'number' ? 'number' : 'text'
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
