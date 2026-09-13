import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'

import { Button } from '@/components/ui/button'
import { renderWithRouter } from '@/test/router-harness'
import { useTableView } from './use-table-view'
import { type TableViewField } from './table-view'

const fields: ReadonlyArray<TableViewField> = [
  { id: 'name', label: 'Name', kind: 'text' }
]

function Harness({ resetPage = true }: { readonly resetPage?: boolean }) {
  const { view, setView } = useTableView('members', fields, resetPage)
  return (
    <Button
      type="button"
      onClick={() =>
        setView({
          ...view,
          filters: [{ field: 'name', operator: 'contains', value: 'a' }]
        })
      }
    >
      {view.filters.length}
    </Button>
  )
}

describe('useTableView', () => {
  it('preserves another list pagination when this table does not use URL pagination', async () => {
    const { router } = await renderWithRouter(<Harness resetPage={false} />, {
      initialEntry: '/?page=3&invitationQuery=invite'
    })
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() =>
      expect(router.state.location.search.tableViews).toContain('members')
    )
    expect(String(router.state.location.search.page)).toBe('3')
    expect(router.state.location.search.invitationQuery).toBe('invite')
  })

  it('reads one table from the map and preserves unrelated search state', async () => {
    const serialized = encodeURIComponent(
      JSON.stringify({
        members: JSON.stringify({ match: 'all', filters: [], sorts: [] }),
        other: JSON.stringify({ match: 'any', filters: [], sorts: [] })
      })
    )
    const { router } = await renderWithRouter(<Harness />, {
      initialEntry: `/?query=keep&page=3&tableViews=${serialized}`
    })
    expect(screen.getByRole('button').textContent).toBe('0')
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() =>
      expect(router.state.location.search.tableViews).toContain('members')
    )
    expect(router.state.location.search.query).toBe('keep')
    expect(router.state.location.search.tableViews).toContain('members')
    expect(router.state.location.search.tableViews).toContain('other')
    expect(router.state.location.search.page).toBeUndefined()
  })
})
