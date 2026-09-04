import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'

import { type consentRequest } from '@/lib/oauth-query'
import { type OAuthConsentPayload } from '@/lib/server/mcp-consent'
import {
  OAuthConsentPage,
  type DenyConsent,
  type GrantConsent
} from '@/routes/oauth.consent'
import { renderWithRouter } from '@/test/router-harness'

// The consent page's ports are plain functions, so the test asserts the two
// outcomes the user sees — a redirect to the provider's answer, or a reason
// in the error slot — the way invitations.accept does.

function workspace(id: string, slug: string, name: string) {
  return { id, slug, name, planId: 'team' }
}

const payload: OAuthConsentPayload = {
  client: {
    clientId: 'https://mcp-client.example.com/oauth/client-metadata.json',
    name: 'Example MCP client',
    uri: 'https://mcp-client.example.com'
  },
  workspaces: [
    {
      workspace: workspace('wrk_a', 'alpha', 'Alpha'),
      memberCount: 2,
      notificationCount: 0
    },
    {
      workspace: workspace('wrk_b', 'beta', 'Beta'),
      memberCount: 1,
      notificationCount: 0
    }
  ],
  oauthQuery: 'client_id=x&sig=abc'
}

const request = {
  clientId: 'https://mcp-client.example.com/oauth/client-metadata.json',
  scopes: ['mcp:read']
}

/** The two ports as typed mocks, defaulted to the provider's happy answers. */
function mockGrant(response: { url: string }): GrantConsent {
  return vi.fn(
    async (_input: {
      readonly data: { readonly workspaceId: string; readonly oauthQuery: string }
    }) => response
  )
}
function mockDeny(response: { url: string }): DenyConsent {
  return vi.fn(
    async (_input: { readonly data: { readonly oauthQuery: string } }) => response
  )
}

async function renderConsent(overrides?: {
  readonly grant?: GrantConsent
  readonly deny?: DenyConsent
  readonly payload?: OAuthConsentPayload
  readonly request?: ReturnType<typeof consentRequest>
}) {
  const grant =
    overrides?.grant ?? mockGrant({ url: 'https://client.example/callback?code=1' })
  const deny =
    overrides?.deny ??
    mockDeny({ url: 'https://client.example/callback?error=access_denied' })
  const assign = vi.fn()
  const req = overrides && 'request' in overrides ? overrides.request : request
  await renderWithRouter(
    <OAuthConsentPage
      payload={overrides?.payload ?? payload}
      request={req}
      grant={grant}
      deny={deny}
      assign={assign}
    />
  )
  return { grant, deny, assign }
}

describe('OAuthConsentPage', () => {
  it('grants with the picked workspace and follows the provider answer', async () => {
    const { grant, assign } = await renderConsent()
    fireEvent.click(screen.getByRole('radio', { name: /Beta/ }))
    fireEvent.click(screen.getByRole('button', { name: /Allow access/ }))
    await waitFor(() => {
      expect(grant).toHaveBeenCalledWith({
        data: { workspaceId: 'wrk_b', oauthQuery: payload.oauthQuery }
      })
      expect(assign).toHaveBeenCalledWith('https://client.example/callback?code=1')
    })
  })

  it('declines without demanding a workspace pick', async () => {
    const { deny, grant, assign } = await renderConsent()
    fireEvent.click(screen.getByRole('button', { name: /Decline/ }))
    await waitFor(() => {
      expect(deny).toHaveBeenCalled()
      expect(grant).not.toHaveBeenCalled()
      expect(assign).toHaveBeenCalledWith(
        'https://client.example/callback?error=access_denied'
      )
    })
  })

  it('keeps Allow disabled until a workspace is picked', async () => {
    // Two workspaces means no radio is preselected: the grant cannot fire,
    // and declining stays available without a pick.
    const { grant, deny } = await renderConsent()
    const allow = screen.getByRole('button', { name: /Allow access/ })
    expect(allow.hasAttribute('disabled')).toBe(true)
    expect(
      screen.getByRole('button', { name: /Decline/ }).hasAttribute('disabled')
    ).toBe(false)
    // Clicking the disabled Allow does nothing: no grant, no decline.
    fireEvent.click(allow)
    expect(grant).not.toHaveBeenCalled()
    expect(deny).not.toHaveBeenCalled()
  })

  it('shows the failure message a failed grant returns', async () => {
    // One workspace preselects itself, so Allow is enabled immediately. The
    // port rejects; `callServerFn` folds that into the error slot's message.
    const { assign } = await renderConsent({
      grant: vi.fn(
        async (_input: {
          readonly data: { readonly workspaceId: string; readonly oauthQuery: string }
        }): Promise<{ url: string }> => {
          throw new Error('authorization collapsed')
        }
      ),
      payload: { ...payload, workspaces: payload.workspaces.slice(0, 1) }
    })
    fireEvent.click(screen.getByRole('button', { name: /Allow access/ }))
    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toContain('authorization collapsed')
      expect(assign).not.toHaveBeenCalled()
    })
  })

  it('explains a page opened without an authorization request', async () => {
    // No signed query to read: the page says so instead of offering buttons.
    await renderConsent({ payload: { ...payload, oauthQuery: null }, request: null })
    expect(screen.getByRole('alert').textContent).toContain(
      'opened without an authorization request'
    )
  })
})
