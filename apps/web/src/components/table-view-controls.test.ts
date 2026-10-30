import { fireEvent, screen, waitFor, within } from '@testing-library/dom'
import { expect, it } from 'vite-plus/test'
import { input } from './native-test-harness'
import { renderTable } from './shared-table-test-harness'

// Selection accessibility/search, DOM identity, operator draft, unique sort
// priorities and atomic clear are the old controls' observable contracts.
it('shows searchable single-choice facets with an accessible selected state', async () => {
  await renderTable()
  fireEvent.click(screen.getByText('Status', { selector: 'summary' }))
  await input(screen.getByLabelText('Search values…'), 'Open')
  expect(screen.queryByRole('option', { name: 'Closed' })).toBeNull()
  fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), {
    target: { value: 'open' }
  })
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLOptionElement>('option', { name: 'Open' }).selected
    ).toBe(true)
  )
  expect(
    await screen.findByText('Status: Is Open', { selector: 'summary' })
  ).toBeDefined()
  expect(screen.queryByText('Bravo')).toBeNull()
})

it('keeps the value input focused while a controlled field changes', async () => {
  await renderTable()
  fireEvent.click(screen.getByText('Name', { selector: 'summary' }))
  const field = screen.getByLabelText('Value')
  field.focus()
  await input(field, 'a')
  expect(document.activeElement).toBe(field)
  await input(field, 'ab')
  expect(document.activeElement).toBe(field)
})

it('keeps a chosen operator before the first value is entered', async () => {
  await renderTable()
  fireEvent.click(screen.getByText('Name', { selector: 'summary' }))
  const controls = within(
    screen.getByText('Name', { selector: 'summary' }).parentElement!
  )
  fireEvent.change(controls.getByRole('combobox', { name: 'Operator' }), {
    target: { value: 'is' }
  })
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
  expect(controls.getByDisplayValue('Is')).toBeDefined()
  expect(screen.getByText('Bravo')).toBeDefined()
  await input(screen.getByLabelText('Value'), 'Alpha')
  await waitFor(() =>
    expect(new URLSearchParams(location.search).get('tableViews')).toContain('Alpha')
  )
  expect(new URLSearchParams(location.search).get('tableViews')).toContain('is')
  expect(screen.queryByText('Bravo')).toBeNull()
})

it('keeps sort fields unique and reorders their priority', async () => {
  await renderTable({
    view: {
      match: 'all',
      filters: [],
      sorts: [
        { field: 'name', direction: 'asc' },
        { field: 'status', direction: 'desc' }
      ]
    }
  })
  fireEvent.click(screen.getByText(/^Sort/, { selector: 'summary' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Move up' })[1]!)
  await waitFor(() => {
    const views = JSON.parse(
      new URLSearchParams(location.search).get('tableViews') ?? '{}'
    )
    expect(JSON.parse(views.members).sorts).toEqual([
      { field: 'status', direction: 'desc' },
      { field: 'name', direction: 'asc' }
    ])
  })
  fireEvent.click(screen.getAllByRole('button', { name: 'Name' })[0]!)
  await waitFor(() => {
    const views = JSON.parse(
      new URLSearchParams(location.search).get('tableViews') ?? '{}'
    )
    expect(
      JSON.parse(views.members).sorts.filter(
        (sort: { field: string }) => sort.field === 'name'
      )
    ).toHaveLength(1)
  })
})

it('clears filters and sorts together', async () => {
  await renderTable({
    view: {
      match: 'any',
      filters: [{ field: 'name', operator: 'contains', value: 'Alpha' }],
      sorts: [{ field: 'name', direction: 'asc' }]
    }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
  await screen.findByText('Bravo')
  await waitFor(() =>
    expect(new URLSearchParams(location.search).has('tableViews')).toBe(false)
  )
})
