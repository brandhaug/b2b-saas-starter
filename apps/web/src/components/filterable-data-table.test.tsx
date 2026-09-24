import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { FilterableDataTable, type DataTableField } from './filterable-data-table'
import {
  DataTableContent,
  DataTablePagination,
  type DataTableColumnDef
} from './data-table'

type Row = { readonly name: string; readonly status: string }
const fields: ReadonlyArray<DataTableField<Row>> = [
  { id: 'name', label: 'Name', kind: 'text', value: (row) => row.name },
  { id: 'status', label: 'Status', kind: 'text', value: (row) => row.status }
]
const columns: ReadonlyArray<DataTableColumnDef<Row>> = [
  { accessorKey: 'name', header: 'Name', enableSorting: true },
  { accessorKey: 'status', header: 'Status', enableSorting: true }
]
const rows: ReadonlyArray<Row> = [
  { name: 'Alpha', status: 'failed' },
  { name: 'Bravo', status: 'delivered' },
  { name: 'Charlie', status: 'failed' },
  { name: 'Delta', status: 'delivered' },
  { name: 'Echo', status: 'failed' }
]

function Table() {
  return (
    <FilterableDataTable
      viewKey="deliveries"
      fields={fields}
      columns={columns}
      data={rows}
      pageSize={2}
      tableLabel="Deliveries"
      emptyMessage="No matching deliveries"
    >
      <DataTableContent />
      <DataTablePagination />
    </FilterableDataTable>
  )
}

describe('FilterableDataTable', () => {
  it('filters across all rows and resets a later page', async () => {
    const { router } = await renderWithRouter(<Table />)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText(/Page 2 of 3/)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Value' }), {
      target: { value: 'Echo' }
    })
    await waitFor(() => expect(screen.getByText(/Page 1 of 1/)).not.toBeNull())
    expect(within(screen.getByRole('table')).getByText('Echo')).not.toBeNull()
    expect(within(screen.getByRole('table')).queryByText('Alpha')).toBeNull()
    expect(router.state.location.search.tableViews).toContain('Echo')
  })

  it('keeps header sorting synchronized with the shared URL view', async () => {
    const { router } = await renderWithRouter(<Table />)
    fireEvent.click(screen.getByRole('button', { name: /Sort by Name/ }))
    await waitFor(() =>
      expect(router.state.location.search.tableViews).toContain('asc')
    )
    fireEvent.click(screen.getByRole('button', { name: /Sort by Name/ }))
    await waitFor(() =>
      expect(router.state.location.search.tableViews).toContain('desc')
    )
    expect(screen.getAllByRole('row')[1]?.textContent).toContain('Echo')
    expect(screen.getByRole('button', { name: /Sort · 1/ })).not.toBeNull()
  })
})
