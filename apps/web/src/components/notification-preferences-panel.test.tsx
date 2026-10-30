import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { type ReactNode } from 'react'
import { fixtureSession } from '@/test/fixture-session'
import { loadNotificationPreferencesHandler } from '@/lib/server/notification-preferences.effects'
import {
  NotificationPreferencesPanel,
  type SetNotificationPreference
} from './notification-preferences-panel'
import type * as RouterModule from '@tanstack/react-router'
import type * as AuthModule from '@/lib/server/auth'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  useRouter: () => ({ invalidate: () => Promise.resolve() })
}))

vi.mock('@/lib/server/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  requireRequestSession: async () => fixtureSession({ userId: 'usr_dev' })
}))

function Providers({ children }: { readonly children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  )
}

describe('NotificationPreferencesPanel', () => {
  it('renders later server preferences after a completed change', async () => {
    const { preferences } = await loadNotificationPreferencesHandler()
    const setPreference = vi.fn<SetNotificationPreference>(async (input) => ({
      ...preferences[0]!,
      ...input.data
    }))
    const client = new QueryClient()
    function panel(channel: 'instant' | 'digest') {
      return (
        <QueryClientProvider client={client}>
          <NotificationPreferencesPanel
            preferences={preferences.map((row) =>
              row.kind === 'announcement'
                ? {
                    kind: row.kind,
                    label: row.label,
                    description: row.description,
                    security: row.security,
                    isDefault: row.isDefault,
                    channel
                  }
                : row
            )}
            setPreference={setPreference}
          />
        </QueryClientProvider>
      )
    }
    const rendered = render(panel('instant'))
    const group = screen.getByRole('radiogroup', {
      name: 'Announcements email channel'
    })
    within(group).getByRole('radio', { name: 'Off' }).click()
    await waitFor(() => expect(setPreference).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(client.isMutating()).toBe(0))
    rendered.rerender(panel('digest'))
    expect(
      within(group)
        .getByRole('radio', { name: 'Daily digest' })
        .getAttribute('aria-checked')
    ).toBe('true')
  })

  it('renders one row per kind from the real loader payload and saves a change', async () => {
    const { preferences } = await loadNotificationPreferencesHandler()
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
