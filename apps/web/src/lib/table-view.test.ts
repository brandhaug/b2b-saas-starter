import { describe, expect, it, vi } from 'vite-plus/test'

import {
  applyTableView,
  defaultTableView,
  parseTableView,
  serializeTableView,
  type TableView,
  type TableViewField
} from './table-view'

/* oxlint-disable effect/noAs, typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion -- test fixtures intentionally exercise union variants. */

vi.mock('./i18n', () => ({ presentationSettings: () => ({ timeZone: zone.value }) }))
const zone = vi.hoisted(() => ({ value: 'UTC' }))

const fields: ReadonlyArray<TableViewField> = [
  { id: 'name', label: 'Name', kind: 'text' },
  {
    id: 'status',
    label: 'Status',
    kind: 'select',
    options: [{ value: 'open', label: 'Open' }]
  }
]

describe('table view model', () => {
  it('round trips valid views and omits the default view', () => {
    const view = {
      match: 'any' as const,
      filters: [{ field: 'name', operator: 'contains' as const, value: 'ada' }],
      sorts: []
    }
    expect(parseTableView(serializeTableView(view), fields)).toEqual(view)
    expect(serializeTableView(defaultTableView)).toBeUndefined()
  })

  it('ignores malformed and unknown entries', () => {
    const serialized = JSON.stringify({
      match: 'wat',
      filters: [
        { field: 'missing', operator: 'contains', value: 'x' },
        { field: 'name', operator: 'contains', value: 'x' },
        { field: 'name', operator: 'wat', value: 'x' }
      ],
      sorts: [
        { field: 'status', direction: 'desc' },
        { field: 'missing', direction: 'asc' }
      ]
    })
    expect(parseTableView(serialized, fields)).toEqual({
      match: 'all',
      filters: [{ field: 'name', operator: 'contains', value: 'x' }],
      sorts: [{ field: 'status', direction: 'desc' }]
    })
  })

  it('keeps one visible condition for each field from URL state', () => {
    const serialized = JSON.stringify({
      filters: [
        { field: 'name', operator: 'contains', value: 'first' },
        { field: 'name', operator: 'is', value: 'hidden' },
        { field: 'status', operator: 'is', value: 'open' }
      ]
    })
    expect(parseTableView(serialized, fields).filters).toEqual([
      { field: 'name', operator: 'contains', value: 'first' },
      { field: 'status', operator: 'is', value: 'open' }
    ])
  })

  it('applies OR filters and stable multi-column sorting', () => {
    const rows = [
      { name: 'Beta', status: 'open' },
      { name: 'Alpha', status: 'open' },
      { name: 'Alpha', status: 'closed' }
    ]
    const view = {
      match: 'any' as const,
      filters: [{ field: 'status', operator: 'is' as const, value: 'open' }],
      sorts: [{ field: 'name', direction: 'asc' as const }]
    }
    expect(
      applyTableView(rows, view, (row, field) => row[field as keyof typeof row])
    ).toEqual([rows[1], rows[0]])
  })

  it('does not filter on incomplete value filters', () => {
    const rows = [{ name: 'Beta' }, { name: 'Alpha' }]
    const view = {
      ...defaultTableView,
      filters: [{ field: 'name', operator: 'contains' as const, value: '' }]
    }
    expect(applyTableView(rows, view, (row) => row.name)).toEqual(rows)
  })

  it('compares date filters by calendar day', () => {
    const rows = [
      { at: new Date('2025-03-10T12:00:00Z') },
      { at: new Date('2025-03-11T12:00:00Z') }
    ]
    const after = {
      ...defaultTableView,
      filters: [{ field: 'at', operator: 'after' as const, value: '2025-03-10' }]
    }
    const equal = {
      ...defaultTableView,
      filters: [{ field: 'at', operator: 'is' as const, value: '2025-03-10' }]
    }
    expect(applyTableView(rows, after, (row) => row.at)).toEqual([rows[1]])
    expect(applyTableView(rows, equal, (row) => row.at)).toEqual([rows[0]])
  })

  it('matches the displayed calendar day in the account time zone', () => {
    zone.value = 'America/Los_Angeles'
    const rows = [
      { at: new Date('2026-05-16T00:00:00Z') },
      { at: new Date('2026-05-16T12:00:00Z') }
    ]
    const view: TableView = {
      ...defaultTableView,
      filters: [{ field: 'at', operator: 'is', value: '2026-05-15' }]
    }
    expect(applyTableView(rows, view, (row) => row.at)).toEqual([rows[0]])
    zone.value = 'UTC'
  })
})
