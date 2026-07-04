import type { ComponentType } from 'react'
import { Suspense } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountRoute } from '@/test/router-mock'

const mocks = vi.hoisted(() => ({
  loaderData: { value: {} as unknown },
  params: { value: { workspaceSlug: 'starter-lab' } },
  navigate: vi.fn(),
  signOut: vi.fn(),
  createApiToken: vi.fn()
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { routerMock } = await import('@/test/router-mock')
  return routerMock({
    actual: await importOriginal<Record<string, unknown>>(),
    routeHooks: {
      useParams: () => mocks.params.value,
      useLoaderData: () => mocks.loaderData.value
    },
    useRouter: () => ({ navigate: mocks.navigate }),
    useNavigate: () => mocks.navigate,
    useParams: () => mocks.params.value
  })
})

vi.mock('@/lib/capabilities', () => ({
  runWorkspaceCapabilities: vi.fn(),
  runCapabilities: vi.fn()
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: { signOut: () => mocks.signOut() }
}))

vi.mock('@/lib/server/api-tokens', () => ({
  createApiTokenServerFn: (input: unknown) => mocks.createApiToken(input)
}))

import { Route } from './workspaces.$workspaceSlug.settings'

let SettingsPage: ComponentType

beforeAll(async () => {
  SettingsPage = await mountRoute(Route)
})

async function renderPage() {
  render(
    <Suspense fallback={null}>
      <SettingsPage />
    </Suspense>
  )
  await screen.findByRole('heading', { name: 'Workspace settings' })
}

const settingsSummary = {
  modules: [
    {
      id: 'effect-v4',
      name: 'Effect v4',
      category: 'architecture',
      summary: 'Typed services, schemas, and HTTP contracts.',
      docsPath: '/docs/architecture/effect-v4',
      optional: false,
      state: {
        moduleId: 'effect-v4',
        enabled: true,
        status: 'ready',
        missingConfig: [],
        updatedAt: '2026-06-01T00:00:00.000Z'
      }
    },
    {
      id: 'email-reports',
      name: 'Email reports',
      category: 'notifications',
      summary: 'Weekly implementation reports through Cloudflare Email.',
      docsPath: '/docs/modules/email-reports',
      optional: true,
      state: {
        moduleId: 'email-reports',
        enabled: false,
        status: 'needs-config',
        missingConfig: ['EMAIL_FROM'],
        updatedAt: '2026-06-01T00:00:00.000Z'
      }
    }
  ],
  apiTokenCount: 3,
  webhookCount: 1,
  unreadCount: 2
}

describe('WorkspaceSettingsPage', () => {
  beforeEach(() => {
    mocks.loaderData.value = settingsSummary
    mocks.params.value = { workspaceSlug: 'starter-lab' }
  })

  it('renders each module with its status badge, including needs-config', async () => {
    await renderPage()
    screen.getByText('Effect v4')
    screen.getByText('ready')
    screen.getByText('Email reports')
    screen.getByText('needs-config')
  })

  it('renders module toggles that reflect enabled state and stay read-only', async () => {
    await renderPage()
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(2)
    const readyToggle = switches[0] as HTMLElement
    const needsConfigToggle = switches[1] as HTMLElement
    expect(readyToggle.getAttribute('aria-checked')).toBe('true')
    expect(needsConfigToggle.getAttribute('aria-checked')).toBe('false')
    for (const toggle of switches) {
      // Base UI marks disabled controls with data-disabled.
      expect((toggle as HTMLElement).hasAttribute('data-disabled')).toBe(true)
    }
  })

  it('renders the operational counts from the loader projection', async () => {
    await renderPage()
    screen.getByText(/3 workspace-scoped tokens are seeded/)
    screen.getByText(/1 endpoint is configured/)
    // Unread-notification badge in the shell header.
    screen.getByText('2')
  })

  it('renders the api token form scoped to the current workspace', async () => {
    await renderPage()
    screen.getByLabelText('Token name')
    screen.getByRole('button', { name: 'Create token' })
  })
})
