import { screen } from '@testing-library/dom'
import { describe, expect, it, vi } from 'vite-plus/test'
import { renderNative } from './native-test-harness'

// The shell's identity line reads the live Better Auth client, whose session
// hook fetches a relative URL no jsdom test can answer.
vi.mock('@/lib/auth-client', async () => {
  const { authClientDouble } = await import('@/test/fake-auth-client')
  return { authClient: authClientDouble }
})

function renderError(denied: boolean) {
  return renderNative({
    _tag: 'ApplicationError',
    flags: {
      status: denied ? 403 : 500,
      section: 'api-tokens',
      error: denied ? { code: 'forbidden', name: 'ForbiddenError', details: {} } : null
    },
    shell: {
      controls: {
        signedIn: true,
        locale: 'en',
        path: '/workspaces/starter-lab/api-tokens',
        docs: []
      },
      session: {
        user: {
          id: 'usr_member',
          name: 'Member',
          email: 'member@example.test',
          emailVerified: true,
          role: 'user',
          twoFactorEnabled: false
        },
        impersonatedBy: null
      },
      directory: [],
      workspaceSlug: 'starter-lab',
      viewer: null,
      preview: false,
      unreadCount: null,
      wide: false
    }
  })
}

describe('workspaceRouteError', () => {
  it('renders a denial as a page of the app, with the shell around it', async () => {
    await renderError(true)
    expect(
      screen.getByRole('heading', { name: 'API tokens access denied' })
    ).toBeTruthy()
    // The landmarks a member lands in: the shell's header, its workspace nav,
    // and the one <main> the skip link targets.
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0)
    const main = document.querySelector('main#main-content')
    expect(main).toBeTruthy()
    // Focusable programmatically, so "Skip to content" moves focus and not
    // only the scroll position.
    expect(main?.getAttribute('tabindex')).toBe('-1')
    // A denial is a decision, not a hiccup: retrying it would decide the same.
    expect(screen.queryByRole('link', { name: 'Try again' })).toBeNull()
  })

  it('offers a retry for a failure that is not a denial', async () => {
    await renderError(false)
    expect(screen.getByRole('heading', { name: 'API tokens unavailable' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Try again' })).toBeTruthy()
  })
})
