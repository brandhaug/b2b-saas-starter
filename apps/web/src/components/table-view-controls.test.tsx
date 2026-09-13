import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'

import { TableViewControls } from './table-view-controls'
import { defaultTableView, type TableView, type TableViewField } from '@/lib/table-view'

const fields: ReadonlyArray<TableViewField> = [
  { id: 'name', label: 'Name', kind: 'text' },
  {
    id: 'status',
    label: 'Status',
    kind: 'select',
    options: [{ value: 'open', label: 'Open' }]
  }
]

function renderControls(view: TableView = defaultTableView) {
  const onChange = vi.fn<(next: TableView) => void>()
  render(<TableViewControls fields={fields} view={view} onChange={onChange} />)
  return onChange
}

describe('TableViewControls', () => {
  it('adds a condition, switches to any matching, and clears all', () => {
    const onChange = renderControls()
    fireEvent.click(screen.getByRole('button', { name: /^Filter/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultTableView,
      filters: [{ field: 'name', operator: 'contains', value: '' }]
    })

    const withFilter: TableView = {
      ...defaultTableView,
      filters: [{ field: 'name', operator: 'contains', value: '' }]
    }
    cleanup()
    const anyChange = renderControls(withFilter)
    fireEvent.click(screen.getByRole('button', { name: 'Filter · 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Any' }))
    expect(anyChange).toHaveBeenLastCalledWith({ ...withFilter, match: 'any' })
  })

  it('shows sort priority controls and clears active rules', () => {
    const view: TableView = {
      match: 'all',
      filters: [],
      sorts: [
        { field: 'name', direction: 'asc' },
        { field: 'status', direction: 'desc' }
      ]
    }
    const onChange = renderControls(view)
    fireEvent.click(screen.getByRole('button', { name: /^Sort/ }))
    expect(screen.getAllByRole('button', { name: 'Move up' })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'Move up' })[1]!)
    expect(onChange).toHaveBeenLastCalledWith({
      ...view,
      sorts: [view.sorts[1], view.sorts[0]]
    })
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(onChange).toHaveBeenLastCalledWith(defaultTableView)
  })

  it('opens the selected condition and removes it directly from its chip', async () => {
    const view: TableView = {
      ...defaultTableView,
      filters: [
        { field: 'name', operator: 'contains', value: 'Ada' },
        { field: 'status', operator: 'is', value: 'open' }
      ]
    }
    const onChange = renderControls(view)
    expect(screen.getByRole('button', { name: 'Filter Status' }).textContent).toContain(
      'Open'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Filter Status' }))
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getAllByRole('combobox', { name: 'Field' })[1]
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter Status' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...view, filters: [view.filters[0]] })
  })

  it('keeps the value input focused while a controlled row changes', () => {
    function Controlled() {
      const [view, setView] = useState<TableView>({
        ...defaultTableView,
        filters: [{ field: 'name', operator: 'contains', value: '' }]
      })
      return <TableViewControls fields={fields} view={view} onChange={setView} />
    }
    render(<Controlled />)
    fireEvent.click(screen.getByRole('button', { name: 'Filter · 1' }))
    const input = screen.getByRole('textbox', { name: 'Value' })
    input.focus()
    fireEvent.change(input, { target: { value: 'a' } })
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: 'ab' } })
    expect(document.activeElement).toBe(input)
  })
})
