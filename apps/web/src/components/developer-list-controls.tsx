import { type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { type WorkspaceView } from '@/lib/workspace-view'
import { m } from '@b2b-saas-starter/i18n/messages'

export type DeveloperListOption = {
  readonly value: string
  readonly label: string
}

export function DeveloperListToolbar({
  query,
  filter,
  sort,
  searchLabel,
  filters,
  sorts,
  onChange
}: {
  readonly query: string
  readonly filter: string
  readonly sort: string
  readonly searchLabel: string
  readonly filters: ReadonlyArray<DeveloperListOption>
  readonly sorts: ReadonlyArray<DeveloperListOption>
  readonly onChange: (change: WorkspaceView, replace?: boolean) => void
}) {
  return (
    <div
      className="flex flex-col gap-2 md:flex-row md:items-center"
      aria-label={searchLabel}
    >
      <Input
        className="md:max-w-sm"
        aria-label={searchLabel}
        placeholder={searchLabel}
        value={query}
        onChange={(event) => {
          onChange({ query: event.target.value || undefined, page: undefined }, true)
        }}
      />
      <DeveloperListSelect
        label={m.developer_list_status()}
        value={filter}
        options={filters}
        onChange={(value) => onChange({ filter: value, page: undefined }, true)}
      />
      <DeveloperListSelect
        label={m.developer_list_sort()}
        value={sort}
        options={sorts}
        onChange={(value) => onChange({ sort: value, page: undefined }, true)}
      />
    </div>
  )
}

function DeveloperListSelect({
  label,
  value,
  options,
  onChange
}: {
  readonly label: string
  readonly value: string
  readonly options: ReadonlyArray<DeveloperListOption>
  readonly onChange: (value: string) => void
}) {
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(next) => {
        if (next !== null) {
          onChange(next)
        }
      }}
    >
      <SelectTrigger aria-label={label} className="md:w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function DeveloperListPagination({
  page,
  pageCount,
  onChange
}: {
  readonly page: number
  readonly pageCount: number
  readonly onChange: (change: WorkspaceView) => void
}): ReactNode {
  if (pageCount <= 1) {
    return null
  }

  return (
    <nav
      className="flex items-center justify-between pt-2"
      aria-label={m.developer_list_page({ page, pages: pageCount })}
    >
      <span className="text-xs text-muted-foreground">
        {m.developer_list_page({ page, pages: pageCount })}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="xs"
          disabled={page === 1}
          onClick={() => onChange({ page: page === 2 ? undefined : String(page - 1) })}
        >
          {m.developer_list_previous()}
        </Button>
        <Button
          variant="outline"
          size="xs"
          disabled={page === pageCount}
          onClick={() => onChange({ page: String(page + 1) })}
        >
          {m.developer_list_next()}
        </Button>
      </div>
    </nav>
  )
}
