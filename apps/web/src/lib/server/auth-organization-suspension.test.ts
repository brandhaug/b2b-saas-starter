import { describe, expect, it, vi } from 'vite-plus/test'

import {
  enforceOrganizationSuspension,
  isOrganizationProductAction,
  type OrganizationSuspensionDependencies,
  type SessionIdentity
} from './auth-organization-suspension'

const session: SessionIdentity = {
  user: { id: 'usr_owner', email: 'owner@example.com' },
  session: { activeOrganizationId: 'wrk_suspended' }
}

function dependencies(suspended = true): OrganizationSuspensionDependencies {
  return {
    listWorkspaces: vi.fn(async (userId) =>
      userId === 'usr_owner'
        ? [
            { id: 'wrk_suspended', slug: 'suspended' },
            { id: 'wrk_active', slug: 'active' }
          ]
        : []
    ),
    invitationDetail: vi.fn(async (id) =>
      id === 'inv_suspended'
        ? { workspaceId: 'wrk_suspended', email: 'invitee@example.com' }
        : undefined
    ),
    isProductAllowed: vi.fn(async (id) => !(suspended && id === 'wrk_suspended'))
  }
}

async function guardedHandler(
  request: Request,
  deps: OrganizationSuspensionDependencies,
  identity: SessionIdentity = session
) {
  const handler = vi.fn(async () => new Response('plugin'))
  const exchange = { method: request.method, pathname: new URL(request.url).pathname }
  const refusal = isOrganizationProductAction(exchange)
    ? await enforceOrganizationSuspension(request, identity, deps)
    : null
  return { response: refusal ?? (await handler()), handler }
}

describe('direct organization endpoint suspension gate', () => {
  it('denies an existing session via active-organization fallback before the plugin runs', async () => {
    const { response, handler } = await guardedHandler(
      new Request('https://example.test/api/auth/organization/list-members'),
      dependencies()
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ code: 'workspace_suspended' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('denies an explicit organization ID before the plugin runs', async () => {
    const deps = dependencies()
    const { response, handler } = await guardedHandler(
      new Request('https://example.test/api/auth/organization/update', {
        method: 'POST',
        body: JSON.stringify({ organizationId: 'wrk_suspended', name: 'Renamed' })
      }),
      deps
    )
    expect(response.status).toBe(403)
    expect(deps.isProductAllowed).toHaveBeenCalledWith('wrk_suspended')
    expect(handler).not.toHaveBeenCalled()
  })

  it('keeps a valid suspended organization ID when a sibling target field is malformed', async () => {
    const deps = dependencies()
    const { response, handler } = await guardedHandler(
      new Request('https://example.test/api/auth/organization/update', {
        method: 'POST',
        body: JSON.stringify({ organizationId: 'wrk_suspended', slug: 123 })
      }),
      deps
    )
    expect(response.status).toBe(403)
    expect(deps.isProductAllowed).toHaveBeenCalledWith('wrk_suspended')
    expect(handler).not.toHaveBeenCalled()
  })

  it('denies invitationId-only accept and reject before the plugin runs', async () => {
    for (const action of ['accept-invitation', 'reject-invitation']) {
      const { response, handler } = await guardedHandler(
        new Request(`https://example.test/api/auth/organization/${action}`, {
          method: 'POST',
          body: JSON.stringify({ invitationId: 'inv_suspended' })
        }),
        dependencies()
      )
      expect(response.status).toBe(403)
      expect(handler).not.toHaveBeenCalled()
    }
  })

  it('allows the invitation recipient to reach the suspension policy', async () => {
    const deps = dependencies()
    const { response, handler } = await guardedHandler(
      new Request('https://example.test/api/auth/organization/accept-invitation', {
        method: 'POST',
        body: JSON.stringify({ invitationId: 'inv_suspended' })
      }),
      deps,
      {
        user: { id: 'usr_invitee', email: 'INVITEE@example.com' },
        session: { activeOrganizationId: null }
      }
    )
    expect(response.status).toBe(403)
    expect(deps.isProductAllowed).toHaveBeenCalledWith('wrk_suspended')
    expect(handler).not.toHaveBeenCalled()
  })

  it('does not disclose an invitation workspace to a user who guessed its ID', async () => {
    const outsider = {
      user: { id: 'usr_outsider', email: 'outsider@example.com' },
      session: { activeOrganizationId: null }
    }
    for (const suspended of [true, false]) {
      const deps = dependencies(suspended)
      const { response, handler } = await guardedHandler(
        new Request('https://example.test/api/auth/organization/accept-invitation', {
          method: 'POST',
          body: JSON.stringify({ invitationId: 'inv_suspended' })
        }),
        deps,
        outsider
      )
      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({ code: 'not_found' })
      expect(deps.isProductAllowed).not.toHaveBeenCalled()
      expect(handler).not.toHaveBeenCalled()
    }
  })

  it('uses slug targets and leaves another active workspace unaffected', async () => {
    const deps = dependencies()
    const { response, handler } = await guardedHandler(
      new Request(
        'https://example.test/api/auth/organization/list-members?organizationSlug=active'
      ),
      deps
    )
    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
    expect(deps.isProductAllowed).toHaveBeenCalledWith('wrk_active')
  })

  it('returns the same not-found response for foreign IDs and slugs', async () => {
    for (const target of ['organizationId=wrk_foreign', 'organizationSlug=foreign']) {
      const { response, handler } = await guardedHandler(
        new Request(
          `https://example.test/api/auth/organization/list-members?${target}`
        ),
        dependencies()
      )
      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({ code: 'not_found' })
      expect(handler).not.toHaveBeenCalled()
    }
  })

  it('does not hand a targetless membership mutation to the plugin without an active workspace', async () => {
    const deps = dependencies(false)
    const { response, handler } = await guardedHandler(
      new Request('https://example.test/api/auth/organization/update-member-role', {
        method: 'POST',
        body: JSON.stringify({ memberId: 'mem_foreign', role: 'member' })
      }),
      deps,
      {
        user: { id: 'usr_outsider', email: 'outsider@example.com' },
        session: { activeOrganizationId: null }
      }
    )
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ code: 'not_found' })
    expect(deps.isProductAllowed).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it('keeps workspace creation, switcher identity and account controls available', async () => {
    expect(
      isOrganizationProductAction({
        method: 'POST',
        pathname: '/api/auth/organization/create'
      })
    ).toBe(false)
    expect(
      isOrganizationProductAction({
        method: 'GET',
        pathname: '/api/auth/organization/list'
      })
    ).toBe(false)
    expect(
      isOrganizationProductAction({
        method: 'POST',
        pathname: '/api/auth/organization/set-active'
      })
    ).toBe(false)
    expect(
      isOrganizationProductAction({ method: 'POST', pathname: '/api/auth/sign-out' })
    ).toBe(false)
    const { response, handler } = await guardedHandler(
      new Request('https://example.test/api/auth/organization/create', {
        method: 'POST',
        body: JSON.stringify({ name: 'New workspace', slug: 'new-workspace' })
      }),
      dependencies()
    )
    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
  })
})
