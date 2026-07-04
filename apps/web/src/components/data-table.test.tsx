import type { ColumnDef } from '@tanstack/react-table'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DataTable } from './data-table'

type Row = {
  readonly name: string
  readonly category: string
}

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name', enableSorting: true },
  { accessorKey: 'category', header: 'Category', enableSorting: false }
]

const rows: readonly Row[] = [
  { name: 'Alpha', category: 'catalog' },
  { name: 'Bravo', category: 'governance' },
  { name: 'Charlie', category: 'catalog' },
  { name: 'Delta', category: 'notifications' },
  { name: 'Echo', category: 'catalog' }
]

describe('DataTable', () => {
  it('renders the empty message when there is no data', () => {
    render(<DataTable columns={columns} data={[]} emptyMessage="No modules yet." />)
    screen.getByText('No modules yet.')
  })

  it('filters rows through the global filter input', () => {
    render(
      <DataTable
        columns={columns}
        data={rows}
        filterColumnId="name"
        filterPlaceholder="Filter modules…"
      />
    )
    fireEvent.change(screen.getByLabelText('Filter modules…'), {
      target: { value: 'brav' }
    })
    screen.getByText('Bravo')
    expect(screen.queryByText('Alpha')).toBeNull()
    expect(screen.queryByText('Charlie')).toBeNull()
  })

  it('paginates rows and disables controls at the boundaries', () => {
    render(<DataTable columns={columns} data={rows} pageSize={2} />)
    screen.getByText(/Page 1 of 3/)
    screen.getByText('Alpha')
    expect(screen.queryByText('Charlie')).toBeNull()

    const previous = screen.getByRole('button', { name: 'Previous' })
    const next = screen.getByRole('button', { name: 'Next' })
    expect((previous as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(next)
    screen.getByText(/Page 2 of 3/)
    screen.getByText('Charlie')
    expect(screen.queryByText('Alpha')).toBeNull()
    expect((previous as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(next)
    screen.getByText(/Page 3 of 3/)
    expect((next as HTMLButtonElement).disabled).toBe(true)
  })

  it('hides pagination controls when everything fits on one page', () => {
    render(<DataTable columns={columns} data={rows} pageSize={10} />)
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
  })

  it('sorts rows when a sortable header is toggled', () => {
    render(<DataTable columns={columns} data={rows} />)
    const sortButton = screen.getByRole('button', { name: /Sort by Name/ })

    fireEvent.click(sortButton)
    let bodyRows = screen.getAllByRole('row').slice(1)
    expect((bodyRows[0] as HTMLElement).textContent).toContain('Alpha')

    fireEvent.click(sortButton)
    bodyRows = screen.getAllByRole('row').slice(1)
    expect((bodyRows[0] as HTMLElement).textContent).toContain('Echo')
  })
})
