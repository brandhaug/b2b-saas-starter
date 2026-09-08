import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { SupportPage } from './support-page'
import { SupportDetails } from './support-details'

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
    await renderWithRouter(
      <SupportPage
        config={{
          email: 'help@example.test',
          helpdeskUrl: 'https://support.example.test',
          helpCenterUrl: 'https://docs.example.test'
        }}
      />
    )
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
    await renderWithRouter(<SupportPage config={config} />)
    expect(screen.queryByText(/support contact information is unavailable/i)).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy support details' })).toBeDefined()
  })

  it('unconfigured production remains honest even with a help center', async () => {
    vi.stubEnv('DEV', false)
    await renderWithRouter(
      <SupportPage config={{ helpCenterUrl: 'https://docs.example.test' }} />
    )
    expect(
      screen.getByText(/support contact information is unavailable/i)
    ).toBeDefined()
    expect(screen.queryByText(/SUPPORT_EMAIL/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy support details' })).toBeDefined()
  })

  it('shows setup guidance only in development', async () => {
    vi.stubEnv('DEV', true)
    await renderWithRouter(<SupportPage config={{}} />)
    expect(screen.getByText(/SUPPORT_EMAIL/)).toBeDefined()
  })

  it('copies only explicit safe fields and omits missing IDs and secret URL input', async () => {
    await renderWithRouter(<SupportPage config={{ appVersion: 'release-288' }} />, {
      path: '/help',
      initialEntry: '/help?token=secret&workspaceId=other&traceId=unrelated'
    })
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
    const view = await renderWithRouter(
      <SupportDetails routeName="workspace" workspaceId="ws_authorized" />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Copy support details' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    expect(writeText.mock.calls[0]?.[0]).toContain('Workspace ID: ws_authorized')
    view.unmount()
    await renderWithRouter(<SupportDetails routeName="application" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy support details' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect(writeText.mock.calls[1]?.[0]).not.toMatch(
      /Workspace|App version|ws_authorized/
    )
  })

  it('announces clipboard failures without claiming success', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    await renderWithRouter(<SupportPage config={{}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy support details' }))
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(
        /could not|couldn't|unable/i
      )
    )
  })
})
