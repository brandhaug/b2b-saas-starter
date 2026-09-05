import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { type ReactNode } from 'react'
import { loadNotificationPreferences } from '@/lib/server/notification-preferences.effects'
import {
  NotificationPreferencesPanel,
  type SetNotificationPreference
} from './notification-preferences-panel'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: () => Promise.resolve() })
}))

function Providers({ children }: { readonly children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  )
}

describe('NotificationPreferencesPanel', () => {
  it('renders one row per kind from the real loader payload and saves a change', async () => {
    const { preferences } = await loadNotificationPreferences({ userId: 'usr_dev' })
    const setPreference = vi.fn<SetNotificationPreference>((input) =>
      Promise.resolve({
        ...input.data,
        isDefault: false,
        label: 'x',
        description: 'x',
        security: false
      })
    )
    render(
      <Providers>
        <NotificationPreferencesPanel
          preferences={preferences}
          highlightKind="announcement"
          setPreference={setPreference}
        />
      </Providers>
    )

    expect(screen.getAllByRole('radiogroup')).toHaveLength(preferences.length)
    expect(screen.getAllByText('Security')).toHaveLength(5)
    expect(
      screen.getByText('Announcements').closest('li')?.getAttribute('data-kind')
    ).toBe('announcement')

    const group = screen.getByRole('radiogroup', {
      name: 'Announcements email channel'
    })
    within(group).getByRole('radio', { name: 'Off' }).click()
    await waitFor(() => {
      expect(setPreference).toHaveBeenCalledWith({
        data: { kind: 'announcement', channel: 'off' }
      })
    })
  })
})
