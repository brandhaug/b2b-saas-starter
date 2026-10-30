import { fireEvent, screen, waitFor, within } from '@testing-library/dom'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderNative } from './native-test-harness'
import { authClientDouble } from '@/test/fake-auth-client'
import { navigateDocument } from '@/lib/document-navigation'
import { stopImpersonatingServerFn } from '@/lib/server/admin'
import type * as AdminModule from '@/lib/server/admin'
import { type PageData } from '@/http/page-contract'
import * as Shell from '@/foldkit/shared/application-shell'

vi.mock('@/lib/auth-client', async () => {
  const { authClientDouble: double } = await import('@/test/fake-auth-client')
  return { authClient: double }
})
vi.mock('@/lib/document-navigation', () => ({ navigateDocument: vi.fn() }))
vi.mock('@/lib/server/admin', async (original) => ({
  ...(await original<typeof AdminModule>()),
  stopImpersonatingServerFn: vi.fn()
}))

const storageKey = 'starter-workspace:usr_dev'
// Preserve preview isolation, impersonation, sign-out/memory, role-gated navigation,
// group ordering, workspace-less/remembered shells and unread-link behavior.
async function renderShell(
  options: {
    slug?: string | null
    role?: 'owner' | 'admin' | 'member'
    systemRole?: string
    impersonatedBy?: string | null
    anonymous?: boolean
    preview?: boolean
    unreadCount?: number
  } = {}
) {
  const slug = options.slug === undefined ? 'starter-lab' : options.slug
  const data: PageData = {
    root: null,
    session: options.anonymous
      ? null
      : {
          user: {
            id: 'usr_dev',
            name: 'Product Engineer',
            email: 'engineer@example.com',
            emailVerified: true,
            role: options.systemRole ?? 'user',
            twoFactorEnabled: false
          },
          impersonatedBy: options.impersonatedBy ?? null
        },
    directory: [
      {
        workspace: {
          id: 'org_demo',
          slug: 'starter-lab',
          name: 'Starter Lab',
          planId: 'starter'
        },
        memberCount: 2,
        notificationCount: 0
      }
    ],
    suspension: null,
    page: { _tag: 'directory', turnstileSiteKey: null },
    locale: 'en',
    presentation: {
      timeZone: 'UTC',
      authenticated: !options.anonymous,
      needsTimeZone: false
    },
    status: 200,
    error: null
  }
  let path = slug === null ? '/workspaces' : `/workspaces/${slug}`
  if (options.preview) {
    path = '/demo'
  }
  const flags: Shell.Flags = {
    ...Shell.flagsForPage(new URL(path, window.location.origin), data),
    workspaceSlug: slug,
    viewer: slug === null ? null : { role: options.role ?? 'member' },
    unreadCount: options.unreadCount ?? null
  }
  const rendered = await renderNative({
    _tag: 'AccountAdmin',
    flags: { search: '', data },
    shell: flags
  })
  return { ...rendered, sidebar: within(rendered.container.querySelector('aside')!) }
}

describe('native workspace shell', () => {
  beforeEach(() => {
    sessionStorage.clear()
    authClientDouble.signOut.mockReset()
    authClientDouble.signOut.mockResolvedValue({ error: null })
    vi.mocked(stopImpersonatingServerFn).mockReset()
    vi.mocked(stopImpersonatingServerFn).mockResolvedValue(undefined)
    vi.mocked(navigateDocument).mockReset()
  })

  it('keeps preview navigation public and leaves the signed-in workspace memory alone', async () => {
    sessionStorage.setItem(storageKey, 'private-workspace')
    const { sidebar } = await renderShell({
      preview: true,
      role: 'owner',
      impersonatedBy: 'usr_admin'
    })
    expect(screen.queryByLabelText('Open user menu')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stop impersonating' })).toBeNull()
    expect(sessionStorage.getItem(storageKey)).toBe('private-workspace')
    expect(sidebar.getByRole('link', { name: 'Members' }).getAttribute('href')).toBe(
      '/demo/members'
    )
    expect(authClientDouble.signOut).not.toHaveBeenCalled()
    expect(stopImpersonatingServerFn).not.toHaveBeenCalled()
  })

  it('shows no impersonation banner for an ordinary session or a public page', async () => {
    const first = await renderShell()
    expect(screen.queryByRole('button', { name: 'Stop impersonating' })).toBeNull()
    first.unmount()
    await renderShell({ anonymous: true })
    expect(screen.queryByRole('button', { name: 'Stop impersonating' })).toBeNull()
  })

  it('shows who is impersonated on an impersonation session, and Stop returns to /admin', async () => {
    await renderShell({ impersonatedBy: 'usr_admin' })
    const banner = screen
      .getAllByRole('status')
      .find((node) => node.textContent.includes('Product Engineer'))
    expect(banner?.textContent).toContain('engineer@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Stop impersonating' }))
    await waitFor(() => expect(stopImpersonatingServerFn).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(navigateDocument).toHaveBeenCalledWith('/admin'))
  })

  it('renders the user menu with sign out, and signs out through the port', async () => {
    await renderShell()
    await waitFor(() => expect(sessionStorage.getItem(storageKey)).toBe('starter-lab'))
    fireEvent.click(screen.getByLabelText('Open user menu'))
    fireEvent.click(screen.getByText('Sign out'))
    await waitFor(() => expect(authClientDouble.signOut).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(navigateDocument).toHaveBeenCalledWith('/sign-in'))
    expect(sessionStorage.getItem(storageKey)).toBeNull()
  })

  it('shows the System admin link only to a system admin', async () => {
    const first = await renderShell({ systemRole: 'user' })
    expect(first.sidebar.queryByRole('link', { name: 'System admin' })).toBeNull()
    first.unmount()
    const admin = await renderShell({ systemRole: 'admin' })
    expect(
      admin.sidebar.getByRole('link', { name: 'System admin' }).getAttribute('href')
    ).toBe('/admin')
  })

  it('groups the nav Workspace, then Developer, then You — never inherited', async () => {
    const { sidebar } = await renderShell({ role: 'owner', systemRole: 'admin' })
    const workspace = sidebar.getByText('Workspace'),
      developer = sidebar.getByText('Developer'),
      you = sidebar.getByText('You')
    expect(
      workspace.compareDocumentPosition(developer) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      developer.compareDocumentPosition(you) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    for (const name of ['Account', 'System admin']) {
      expect(
        you.compareDocumentPosition(sidebar.getByRole('link', { name })) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    }
    expect(sidebar.getByText('Administration')).toBeDefined()
  })

  it('keeps the sidebar column but not its workspace rows when no workspace is in play', async () => {
    const { sidebar } = await renderShell({ slug: null, systemRole: 'admin' })
    expect(sidebar.queryByRole('link', { name: 'Overview' })).toBeNull()
    expect(sidebar.queryByRole('link', { name: 'Settings' })).toBeNull()
    expect(sidebar.getByRole('option', { name: 'Choose a workspace…' })).toBeDefined()
    expect(sidebar.getByText('You')).toBeDefined()
    expect(sidebar.getByRole('link', { name: 'Account' })).toBeDefined()
    expect(sidebar.getByRole('link', { name: 'System admin' })).toBeDefined()
  })

  it('anchors a system surface to the last visited workspace', async () => {
    sessionStorage.setItem(storageKey, 'starter-lab')
    const { sidebar } = await renderShell({ slug: null, systemRole: 'admin' })
    const overview = await sidebar.findByRole('link', { name: 'Overview' })
    expect(overview.getAttribute('href')).toBe('/workspaces/starter-lab')
    expect(sidebar.getByRole('link', { name: 'Settings' })).toBeDefined()
    expect(
      sidebar.getByRole<HTMLOptionElement>('option', { name: 'Starter Lab' }).selected
    ).toBe(true)
    expect(sidebar.getByRole('link', { name: 'Account' })).toBeDefined()
    expect(sidebar.getByRole('link', { name: 'System admin' })).toBeDefined()
  })

  it('hides permission-gated entries from a member and shows them to an owner', async () => {
    const member = await renderShell({ role: 'member' })
    for (const name of ['API tokens', 'Webhook endpoints', 'Audit trail']) {
      expect(member.sidebar.queryByRole('link', { name })).toBeNull()
    }
    expect(member.sidebar.getByRole('link', { name: 'Overview' })).toBeDefined()
    member.unmount()
    const owner = await renderShell({ role: 'owner' })
    for (const name of ['API tokens', 'Webhook endpoints', 'Audit trail']) {
      expect(owner.sidebar.getByRole('link', { name })).toBeDefined()
    }
  })

  it('renders the unread badge as a link to the notifications route', async () => {
    const first = await renderShell({ unreadCount: 4 })
    expect(
      screen.getByRole('link', { name: '4 unread notifications' }).getAttribute('href')
    ).toBe('/account/notifications')
    first.unmount()
    await renderShell()
    expect(screen.queryByRole('link', { name: '4 unread notifications' })).toBeNull()
  })
})
