import { fireEvent, screen, waitFor, within } from '@testing-library/dom'
import { expect, it } from 'vite-plus/test'
import { input } from './native-test-harness'
import { renderTable } from './shared-table-test-harness'

// Retain global search, protected/searchable columns, page boundaries, reset,
// and all-loaded-row refresh. These assertions precede any native table repair.
it('filters rows through the global filter input', async () => {
  await renderTable()
  await input(screen.getByLabelText('Search'), 'brav')
  expect(await screen.findByText('Bravo')).toBeDefined()
  expect(screen.queryByText('Alpha')).toBeNull()
  expect(screen.queryByText('Charlie')).toBeNull()
})

it('toggles columns from the searchable column picker', async () => {
  await renderTable()
  fireEvent.click(screen.getByText('Columns'))
  expect(screen.queryByRole('checkbox', { name: 'Name' })).toBeNull()
  await input(screen.getByLabelText('Search columns…'), 'Status')
  expect(screen.queryByRole('checkbox', { name: 'Name' })).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Status' }))
  await waitFor(() =>
    expect(screen.queryByRole('columnheader', { name: 'Status' })).toBeNull()
  )
})

it('paginates rows and disables controls at the boundaries', async () => {
  await renderTable({ pageSize: 2 })
  const previous = screen.getByRole<HTMLButtonElement>('button', { name: 'Previous' })
  const next = screen.getByRole<HTMLButtonElement>('button', { name: 'Next' })
  expect(previous.disabled).toBe(true)
  expect(screen.queryByText('Charlie')).toBeNull()
  fireEvent.click(next)
  await screen.findByText('Charlie')
  expect(previous.disabled).toBe(false)
  expect(screen.queryByText('Alpha')).toBeNull()
  fireEvent.click(next)
  await screen.findByText('Echo')
  expect(next.disabled).toBe(true)
})

it('shares filter and pagination state and resets the page for filtered results', async () => {
  await renderTable({ pageSize: 2 })
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByText('Charlie')
  await input(screen.getByLabelText('Search'), 'echo')
  await screen.findByText('Echo')
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Previous' }).disabled
  ).toBe(true)
})

it('renders every loaded row without client pagination, including after a refresh', async () => {
  await renderTable()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh rows' }))
  await waitFor(() =>
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(12)
  )
  expect(screen.getByText('Kilo')).toBeDefined()
})
