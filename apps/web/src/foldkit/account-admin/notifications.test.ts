import { fireEvent, screen, waitFor, within } from '@testing-library/dom'
import { expect, it, vi } from 'vite-plus/test'
import { fixtureSession } from '@/test/fixture-session'
import { loadNotificationPreferencesHandler } from '@/lib/server/notification-preferences.effects'
import type * as AuthModule from '@/lib/server/auth'
import { renderAccount } from './test-runtime'
import * as Notifications from './notifications'

const save = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/notification-preferences', () => ({
  setNotificationPreferenceServerFn: save
}))
vi.mock('@/lib/server/auth', async (original) => ({
  ...(await original<typeof AuthModule>()),
  requireRequestSession: async () => fixtureSession({ userId: 'usr_dev' })
}))

it('renders one row per kind from the real loader payload and saves a change', async () => {
  const { preferences } = await loadNotificationPreferencesHandler()
  save.mockImplementation(async (input) => ({
    ...input.data,
    isDefault: false,
    label: 'Announcements',
    description: 'Announcements',
    security: false
  }))
  await renderAccount({
    notifications: Notifications.init(preferences, [], '?kind=announcement').model
  })
  // Native fieldsets retain the channel group's accessible name and radios.
  expect(screen.getAllByRole('group')).toHaveLength(preferences.length)
  expect(screen.getAllByText('Security')).toHaveLength(5)
  expect(
    screen.getByText('Announcements').closest('li')?.getAttribute('data-kind')
  ).toBe('announcement')
  fireEvent.click(
    within(
      screen.getByRole('group', { name: 'Announcements email channel' })
    ).getByRole('radio', { name: 'Off' })
  )
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      data: { kind: 'announcement', channel: 'off' }
    })
  )
  await waitFor(() =>
    expect(
      within(
        screen.getByRole('group', { name: 'Announcements email channel' })
      ).getByRole('radio', { name: 'Off' })
    ).toHaveProperty('checked', true)
  )
})
