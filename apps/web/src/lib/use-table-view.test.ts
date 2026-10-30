import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { expect, it } from 'vite-plus/test'
import { renderTable } from '@/components/shared-table-test-harness'
import { renderWorkspace } from '@/foldkit/workspace/test-harness'
import { demoFixtures } from '@/lib/demo-fixtures'
import { input } from '@/components/native-test-harness'

// Local account-table pages must not clear a different list's URL page. Saved
// views must round-trip without losing another list, search, or drawer state.
it('preserves another list pagination when this table does not use URL pagination', async () => {
  await renderTable({ search: '?page=3&invitationQuery=invite' })
  fireEvent.click(
    screen.getByRole('columnheader', { name: 'Name' }).querySelector('button')!
  )
  await waitFor(() =>
    expect(new URLSearchParams(location.search).get('tableViews')).toContain('members')
  )
  expect(new URLSearchParams(location.search).get('page')).toBe('3')
  expect(new URLSearchParams(location.search).get('invitationQuery')).toBe('invite')
})

it('reads one table from the map and preserves unrelated search state', async () => {
  const serialized = encodeURIComponent(
    JSON.stringify({
      members: JSON.stringify({
        match: 'all',
        filters: [{ field: 'name', operator: 'contains', value: 'Dev' }],
        sorts: []
      }),
      other: JSON.stringify({ match: 'any', filters: [], sorts: [] })
    })
  )
  await renderWorkspace(
    { _tag: 'members', data: demoFixtures.members },
    {
      url: `/workspaces/starter-lab/members?query=keep&page=3&tableViews=${serialized}`
    }
  )
  fireEvent.click(screen.getByRole('button', { name: 'Name: Dev' }))
  const value = await screen.findByDisplayValue('Dev')
  await input(value, 'Alpha')
  await waitFor(() =>
    expect(new URLSearchParams(location.search).get('tableViews')).toContain('Alpha')
  )
  expect(new URLSearchParams(location.search).get('query')).toBe('keep')
  expect(new URLSearchParams(location.search).get('tableViews')).toContain('other')
  expect(new URLSearchParams(location.search).has('page')).toBe(false)
})
