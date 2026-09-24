import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'

import { defaultTableView, type TableView, type TableViewField } from '@/lib/table-view'
import { TableViewControls } from './table-view-controls'

const fields: ReadonlyArray<TableViewField> = [
  { id: 'name', label: 'Name', kind: 'text' },
  { id: 'createdAt', label: 'Created', kind: 'date' },
  {
    id: 'status',
    label: 'Status',
    kind: 'select',
    options: [
      { value: 'open', label: 'Open' },
      { value: 'closed', label: 'Closed' }
    ]
  }
]

function installCommandStubs() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  Element.prototype.scrollIntoView = () => {}
}

function renderControls(view: TableView = defaultTableView) {
  const onChange = vi.fn<(next: TableView) => void>()
  render(<TableViewControls fields={fields} view={view} onChange={onChange} />)
  return onChange
}

describe('TableViewControls', () => {
  it('shows searchable single-choice facets with an accessible selected state', () => {
    installCommandStubs()
    const onChange = renderControls()
    fireEvent.click(screen.getByRole('button', { name: 'Status' }))
    expect(screen.getByRole('textbox', { name: 'Search values…' })).not.toBeNull()
    const open = screen.getByRole('radio', { name: 'Open' })
    expect(open.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(open)
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultTableView,
      filters: [{ field: 'status', operator: 'is', value: 'open' }]
    })

    cleanup()
    renderControls({
      ...defaultTableView,
      filters: [{ field: 'status', operator: 'is', value: 'open' }]
    })
    const trigger = screen.getByRole('button', { name: 'Status: Is Open' })
    expect(trigger.textContent).toContain('Open')
    fireEvent.click(trigger)
    expect(
      screen.getByRole('radio', { name: 'Open' }).getAttribute('aria-checked')
    ).toBe('true')
  })

  it('keeps the value input focused while a controlled field changes', () => {
    function Controlled() {
      const [view, setView] = useState<TableView>(defaultTableView)
      return <TableViewControls fields={fields} view={view} onChange={setView} />
    }
    render(<Controlled />)
    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    const input = screen.getByRole('textbox', { name: 'Value' })
    input.focus()
    fireEvent.change(input, { target: { value: 'a' } })
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: 'ab' } })
    expect(document.activeElement).toBe(input)
  })

  it('keeps a chosen operator before the first value is entered', () => {
    const onChange = renderControls()
    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Operator' }))
    const option = screen.getByRole('option', { name: 'Is' })
    fireEvent.pointerDown(option)
    fireEvent.pointerUp(option)
    fireEvent.click(option)
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.change(screen.getByRole('textbox', { name: 'Value' }), {
      target: { value: 'Ada' }
    })
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultTableView,
      filters: [{ field: 'name', operator: 'is', value: 'Ada' }]
    })
  })

  it('keeps sort fields unique and reorders their priority', () => {
    const view: TableView = {
      match: 'all',
      filters: [],
      sorts: [
        { field: 'name', direction: 'asc' },
        { field: 'status', direction: 'desc' }
      ]
    }
    const onChange = renderControls(view)
    fireEvent.click(screen.getByRole('button', { name: 'Sort · 2' }))
    const fieldTriggers = screen.getAllByRole('combobox', { name: 'Field' })
    fireEvent.click(fieldTriggers[0]!)
    expect(screen.queryByRole('option', { name: 'Status' })).toBeNull()
    expect(screen.getByRole('option', { name: 'Created' })).not.toBeNull()
    fireEvent.keyDown(fieldTriggers[0]!, { key: 'Escape' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Move up' })[1]!)
    expect(onChange).toHaveBeenLastCalledWith({
      ...view,
      sorts: [view.sorts[1]!, view.sorts[0]!]
    })
  })

  it('clears filters and sorts together', () => {
    const view: TableView = {
      match: 'any',
      filters: [{ field: 'name', operator: 'contains', value: 'Ada' }],
      sorts: [{ field: 'name', direction: 'asc' }]
    }
    const onChange = renderControls(view)
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(onChange).toHaveBeenLastCalledWith(defaultTableView)
  })
})
