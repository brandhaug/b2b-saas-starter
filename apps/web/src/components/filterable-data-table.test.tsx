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
      searchPlaceholder="Search deliveries"
    >
      <DataTableContent />
      <DataTablePagination />
    </FilterableDataTable>
  )
}

describe('FilterableDataTable', () => {
  it('restores namespaced search and pagination from a direct link and history', async () => {
    const views = encodeURIComponent(
      JSON.stringify({
        deliveries: JSON.stringify({
          match: 'all',
          filters: [],
          sorts: [],
          query: 'failed',
          pageIndex: 1
        }),
        other: JSON.stringify({
          match: 'any',
          filters: [],
          sorts: [],
          query: 'keep',
          pageIndex: 4
        })
      })
    )
    const { router } = await renderWithRouter(<Table />, {
      initialEntry: `/?tableViews=${views}`
    })
    expect(
      screen.getByRole('textbox', { name: 'Search deliveries' }).getAttribute('value')
    ).toBe('failed')
    expect(within(screen.getByRole('table')).getByText('Echo')).not.toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search deliveries' }), {
      target: { value: 'Bravo' }
    })
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getByText('Bravo')).not.toBeNull()
    )
    expect(router.state.location.search.tableViews).toContain('keep')
    router.history.back()
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getByText('Echo')).not.toBeNull()
    )
    expect(screen.getByText(/Page 2 of 2/)).not.toBeNull()
    router.history.forward()
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getByText('Bravo')).not.toBeNull()
    )
    expect(screen.getByText(/Page 1 of 1/)).not.toBeNull()
  })

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
