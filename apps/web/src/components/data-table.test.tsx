import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import {
  DataTable,
  DataTableContent,
  DataTableFilter,
  DataTablePagination,
  type DataTableColumnDef
} from './data-table'

type Row = {
  readonly name: string
  readonly category: string
}

const columns: Array<DataTableColumnDef<Row>> = [
  { accessorKey: 'name', header: 'Name', enableSorting: true },
  { accessorKey: 'category', header: 'Category', enableSorting: false }
]

const rows: ReadonlyArray<Row> = [
  { name: 'Alpha', category: 'catalog' },
  { name: 'Bravo', category: 'governance' },
  { name: 'Charlie', category: 'catalog' },
  { name: 'Delta', category: 'notifications' },
  { name: 'Echo', category: 'catalog' }
]

describe('DataTable', () => {
  it('renders the empty message when there is no data', () => {
    render(
      <DataTable columns={columns} data={[]} emptyMessage="No modules yet.">
        <DataTableContent />
      </DataTable>
    )
    screen.getByText('No modules yet.')
  })

  it('filters rows through the global filter input', () => {
    render(
      <DataTable columns={columns} data={rows}>
        <DataTableFilter placeholder="Filter modules…" />
        <DataTableContent />
      </DataTable>
    )
    fireEvent.change(screen.getByLabelText('Filter modules…'), {
      target: { value: 'brav' }
    })
    screen.getByText('Bravo')
    expect(screen.queryByText('Alpha')).toBeNull()
    expect(screen.queryByText('Charlie')).toBeNull()
  })

  it('paginates rows and disables controls at the boundaries', () => {
    render(
      <DataTable columns={columns} data={rows} pageSize={2}>
        <DataTableContent />
        <DataTablePagination />
      </DataTable>
    )
    screen.getByText(/Page 1 of 3/)
    screen.getByText('Alpha')
    expect(screen.queryByText('Charlie')).toBeNull()

    const previous = screen.getByRole<HTMLButtonElement>('button', { name: 'Previous' })
    const next = screen.getByRole<HTMLButtonElement>('button', { name: 'Next' })
    expect(previous.disabled).toBe(true)

    fireEvent.click(next)
    screen.getByText(/Page 2 of 3/)
    screen.getByText('Charlie')
    expect(screen.queryByText('Alpha')).toBeNull()
    expect(previous.disabled).toBe(false)

    fireEvent.click(next)
    screen.getByText(/Page 3 of 3/)
    expect(next.disabled).toBe(true)
  })

  it('keeps pagination controls rendered but disabled when everything fits on one page', () => {
    render(
      <DataTable columns={columns} data={rows} pageSize={10}>
        <DataTableContent />
        <DataTablePagination />
      </DataTable>
    )
    const next = screen.getByRole<HTMLButtonElement>('button', { name: 'Next' })
    expect(next.disabled).toBe(true)
  })

  it('sorts rows when a sortable header is toggled', () => {
    render(
      <DataTable columns={columns} data={rows}>
        <DataTableContent />
      </DataTable>
    )
    const sortButton = screen.getByRole('button', { name: /Sort by Name/ })

    fireEvent.click(sortButton)
    let bodyRows = screen.getAllByRole('row').slice(1)
    expect(bodyRows[0]?.textContent).toContain('Alpha')

    fireEvent.click(sortButton)
    bodyRows = screen.getAllByRole('row').slice(1)
    expect(bodyRows[0]?.textContent).toContain('Echo')
  })

  it('shares filter and pagination state and resets the page for filtered results', () => {
    render(
      <DataTable columns={columns} data={rows} pageSize={2}>
        <header>
          <DataTableFilter placeholder="Filter modules…" />
        </header>
        <DataTableContent />
        <footer>
          <DataTablePagination />
        </footer>
      </DataTable>
    )

    fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: 'Next' }))
    screen.getByText(/Page 2 of 3/)
    fireEvent.change(screen.getByLabelText('Filter modules…'), {
      target: { value: 'echo' }
    })
    screen.getByText('Echo')
    expect(screen.queryByText(/Page 2 of/)).toBeNull()
  })

  it('renders every loaded row without client pagination, including after a refresh', () => {
    const { rerender } = render(
      <DataTable columns={columns} data={rows}>
        <DataTableContent />
      </DataTable>
    )
    const refreshedRows = [
      ...rows,
      { name: 'Foxtrot', category: 'catalog' },
      { name: 'Golf', category: 'catalog' },
      { name: 'Hotel', category: 'catalog' },
      { name: 'India', category: 'catalog' },
      { name: 'Juliet', category: 'catalog' },
      { name: 'Kilo', category: 'catalog' }
    ]
    rerender(
      <DataTable columns={columns} data={refreshedRows}>
        <DataTableContent />
      </DataTable>
    )
    expect(screen.getAllByRole('row')).toHaveLength(12)
    screen.getByText('Kilo')
  })
})
