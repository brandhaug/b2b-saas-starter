import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderNative, renderSupport } from './native-test-harness'
import { type Flags as HelpFlags } from '@/foldkit/public/help'

function renderHelp(config: Partial<HelpFlags>) {
  return renderNative({
    _tag: 'Public',
    flags: {
      shell: { signedIn: false, locale: 'en', path: '/help', docs: [] },
      page: {
        _tag: 'Help',
        flags: {
          email: null,
          helpdeskUrl: null,
          helpCenterUrl: null,
          appVersion: null,
          ...config
        }
      }
    }
  })
}

const writeText = vi.fn<(text: string) => Promise<void>>()
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText }
  })
})
afterEach(() => vi.unstubAllEnvs())

describe('customer support acceptance', () => {
  it('offers the helpdesk first and email as an alternative, without diagnostic prefill', async () => {
    await renderHelp({
      email: 'help@example.test',
      helpdeskUrl: 'https://support.example.test',
      helpCenterUrl: 'https://docs.example.test'
    })
    const links = screen.getAllByRole('link')
    const helpdesk = links.findIndex(
      (link) => link.getAttribute('href') === 'https://support.example.test'
    )
    const email = links.findIndex(
      (link) => link.getAttribute('href') === 'mailto:help%40example.test'
    )
    expect(helpdesk).toBeGreaterThanOrEqual(0)
    expect(email).toBeGreaterThan(helpdesk)
    expect(
      links.some((link) => link.getAttribute('href') === 'https://docs.example.test')
    ).toBe(true)
    expect(writeText).not.toHaveBeenCalled()
  })

  it.each([
    { email: 'help@example.test' },
    { helpdeskUrl: 'https://support.example.test' }
  ])('supports either contact destination alone: %j', async (config) => {
    await renderHelp(config)
    expect(screen.queryByText(/support contact information is unavailable/i)).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy support details' })).not.toBeNull()
  })

  it('unconfigured production remains honest even with a help center', async () => {
    vi.stubEnv('DEV', false)
    await renderHelp({ helpCenterUrl: 'https://docs.example.test' })
    expect(
      screen.getByText(/support contact information is unavailable/i)
    ).not.toBeNull()
    expect(screen.queryByText(/SUPPORT_EMAIL/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy support details' })).not.toBeNull()
  })

  it('does not tell the visitor to choose when there is nothing to choose', async () => {
    vi.stubEnv('DEV', false)
    await renderHelp({})
    expect(screen.queryByText(/choose a contact option/i)).toBeNull()
    expect(
      screen.getAllByText(/support contact information is unavailable/i)
    ).toHaveLength(1)
  })

  it('leads with the contact options when the deployment configured them', async () => {
    await renderHelp({ email: 'help@example.test' })
    expect(screen.getByText(/choose a contact option/i)).toBeDefined()
  })

  it('shows setup guidance only in development', async () => {
    vi.stubEnv('DEV', true)
    await renderHelp({})
    expect(screen.getByText(/SUPPORT_EMAIL/)).not.toBeNull()
  })

  it('copies only explicit safe fields and omits missing IDs and secret URL input', async () => {
    window.history.replaceState(
      null,
      '',
      '/help?token=secret&workspaceId=other&traceId=unrelated'
    )
    await renderHelp({ appVersion: 'release-288' })
    fireEvent.click(screen.getByRole('button', { name: 'Copy support details' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    const copied = writeText.mock.calls[0]?.[0]
    expect(copied).toMatch(
      /^Time \(UTC\): \d{4}-\d{2}-\d{2}T.*Z\nRoute: help\nApp version: release-288$/
    )
    expect(copied).not.toMatch(/secret|other|unrelated|Workspace|trace/i)
    expect(screen.getByRole('status').textContent).toMatch(/copied/i)
  })

  it('copies an authorized workspace and drops it when the current context changes', async () => {
    const view = await renderSupport({
      routeName: 'workspace',
      workspaceId: 'ws_authorized',
      appVersion: null
    })
    fireEvent.click(screen.getByRole('button', { name: 'Copy support details' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    expect(writeText.mock.calls[0]?.[0]).toContain('Workspace ID: ws_authorized')
    view.unmount()
    await renderSupport({
      routeName: 'application',
      workspaceId: null,
      appVersion: null
    })
    fireEvent.click(screen.getByRole('button', { name: 'Copy support details' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect(writeText.mock.calls[1]?.[0]).not.toMatch(
      /Workspace|App version|ws_authorized/
    )
  })

  it('announces clipboard failures without claiming success', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    await renderHelp({})
    fireEvent.click(screen.getByRole('button', { name: 'Copy support details' }))
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(
        /could not|couldn't|unable/i
      )
    )
  })
})
