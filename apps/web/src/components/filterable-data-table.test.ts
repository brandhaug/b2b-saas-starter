import { fireEvent, screen, waitFor, within } from '@testing-library/dom'
import { expect, it } from 'vite-plus/test'
import { input } from './native-test-harness'
import { renderTable } from './shared-table-test-harness'

// Filter before pagination; header sort and URL must agree.
it('filters across all rows and resets a later page', async () => {
  await renderTable({ pageSize: 2 })
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByText('Charlie')
  fireEvent.click(screen.getByText('Name', { selector: 'summary' }))
  await input(screen.getByLabelText('Value'), 'Echo')
  expect(await screen.findByText('Echo')).toBeDefined()
  expect(screen.queryByText('Alpha')).toBeNull()
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Previous' }).disabled
  ).toBe(true)
  await waitFor(() =>
    expect(new URLSearchParams(location.search).get('tableViews')).toContain('Echo')
  )
})

it('keeps header sorting synchronized with the shared URL view', async () => {
  await renderTable({ pageSize: 2 })
  const header = within(screen.getByRole('columnheader', { name: 'Name' })).getByRole(
    'button'
  )
  fireEvent.click(header)
  await waitFor(() =>
    expect(new URLSearchParams(location.search).get('tableViews')).toContain('asc')
  )
  fireEvent.click(header)
  await waitFor(() =>
    expect(new URLSearchParams(location.search).get('tableViews')).toContain('desc')
  )
  expect(screen.getAllByRole('row')[1]?.textContent).toContain('Echo')
  fireEvent.click(screen.getByText(/^Sort/, { selector: 'summary' }))
  expect(screen.getByText('Name: desc')).toBeDefined()
  expect(screen.getByText('Sort · 1', { selector: 'summary' })).toBeDefined()
})
