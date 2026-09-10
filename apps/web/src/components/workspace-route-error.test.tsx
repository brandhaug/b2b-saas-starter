import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { ForbiddenError } from '@/lib/capability-error'
import { workspaceRouteError } from './workspace-route-error'
import { m } from '@b2b-saas-starter/i18n/messages'

// The shell's identity line reads the live Better Auth client, whose session
// hook fetches a relative URL no jsdom test can answer.
vi.mock('@/lib/auth-client', async () => {
  const { authClientDouble } = await import('@/test/fake-auth-client')
  return { authClient: authClientDouble }
})

const ApiTokensRouteError = workspaceRouteError({
  deniedTitle: m.api_tokens_access_denied,
  deniedDescription: m.api_tokens_forbidden_description,
  failedTitle: m.api_tokens_unavailable,
  failedDescription: m.api_tokens_load_failed
})

function renderError(error: Error) {
  return renderWithRouter(<ApiTokensRouteError error={error} />, {
    path: '/workspaces/$workspaceSlug/api-tokens',
    initialEntry: '/workspaces/starter-lab/api-tokens',
    destinations: ['/workspaces', '/sign-in'],
    routeContext: {}
  })
}

describe('workspaceRouteError', () => {
  it('renders a denial as a page of the app, with the shell around it', async () => {
    await renderError(new ForbiddenError('denied'))
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
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('offers a retry for a failure that is not a denial', async () => {
    await renderError(new Error('boom'))
    expect(screen.getByRole('heading', { name: 'API tokens unavailable' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})
