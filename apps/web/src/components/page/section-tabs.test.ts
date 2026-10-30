import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { expect, it } from 'vite-plus/test'
import { renderWorkspace } from '@/foldkit/workspace/test-harness'
import { demoFixtures } from '@/lib/demo-fixtures'
import { input } from '../native-test-harness'

// Native page state owns form drafts independently of URL tab selection.
it('opens the linked tab, preserves form edits and restores the tab with Back', async () => {
  await renderWorkspace(
    { _tag: 'settings', data: demoFixtures.settings },
    { url: '/workspaces/starter-lab/settings?tab=sso' }
  )
  expect(
    screen.getByRole('tab', { name: 'Single sign-on' }).getAttribute('aria-selected')
  ).toBe('true')
  fireEvent.click(screen.getByRole('tab', { name: 'General' }))
  await waitFor(() =>
    expect(new URLSearchParams(location.search).get('tab')).toBe('general')
  )
  await input(screen.getByLabelText('Workspace name'), 'Operations')
  fireEvent.click(screen.getByRole('tab', { name: 'Single sign-on' }))
  await waitFor(() =>
    expect(new URLSearchParams(location.search).get('tab')).toBe('sso')
  )
  window.history.back()
  await waitFor(() =>
    expect(
      screen.getByRole('tab', { name: 'General' }).getAttribute('aria-selected')
    ).toBe('true')
  )
  expect(screen.getByDisplayValue('Operations')).toBeDefined()
})

it('opens a linked creation form only when permitted', async () => {
  await renderWorkspace(
    { _tag: 'members', data: { ...demoFixtures.members, viewer: { role: 'member' } } },
    { url: '/workspaces/starter-lab/members?action=invite' }
  )
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByText(/role cannot invite/)).toBeDefined()
})

it('opens a creation form directly from its URL', async () => {
  await renderWorkspace(
    { _tag: 'members', data: demoFixtures.members },
    { url: '/workspaces/starter-lab/members?action=invite' }
  )
  expect(await screen.findByRole('dialog', { name: 'Invite a member' })).toBeDefined()
})

// Failure cases: history can leave a stale modal open or fail to reopen it;
// keyboard selection can leave focus behind or expose every tab as a Tab stop.
it('closes and reopens creation with browser history', async () => {
  await renderWorkspace({ _tag: 'members', data: demoFixtures.members })
  fireEvent.click(screen.getByRole('button', { name: 'Invite a member' }))
  await screen.findByRole('dialog', { name: 'Invite a member' })
  await waitFor(() => expect(location.search).toContain('action=invite'))
  window.history.back()
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  window.history.forward()
  expect(await screen.findByRole('dialog', { name: 'Invite a member' })).toBeDefined()
})

it('moves tab selection and focus with arrows and associates the panel', async () => {
  await renderWorkspace({ _tag: 'settings', data: demoFixtures.settings })
  const general = screen.getByRole('tab', { name: 'General' })
  general.focus()
  fireEvent.keyDown(general, { key: 'ArrowRight' })
  const sso = screen.getByRole('tab', { name: 'Single sign-on' })
  await waitFor(() => expect(sso.getAttribute('aria-selected')).toBe('true'))
  expect(document.activeElement).toBe(sso)
  expect(sso.getAttribute('tabindex')).toBe('0')
  expect(general.getAttribute('tabindex')).toBe('-1')
  expect(screen.getByRole('tabpanel').id).toBe(sso.getAttribute('aria-controls'))
  fireEvent.keyDown(sso, { key: 'Home' })
  await waitFor(() => expect(general.getAttribute('aria-selected')).toBe('true'))
})
