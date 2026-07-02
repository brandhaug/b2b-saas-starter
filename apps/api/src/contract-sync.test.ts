import { describe, expect, it } from 'vitest'
import { StarterApi } from '@b2b-saas-starter/api'
import { matchRoute, routes } from './routes.ts'

// The HttpApi contracts in `packages/api` are the source of truth for the
// REST Capability Interface; the route table in `routes.ts` mirrors their
// paths by hand. This suite walks every endpoint declared on `StarterApi` and
// asserts the table carries it, so a new contract without a route — or a
// path/method drift between the two — fails here instead of 404ing in
// production.

const PARAM_SAMPLES: Record<string, string> = {
  slug: 'starter-lab',
  tokenId: 'tok_1'
}

const concretePath = (template: string): string =>
  template.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = PARAM_SAMPLES[name]
    if (!value) throw new Error(`no sample value for path param :${name}`)
    return value
  })

type ContractEndpoint = {
  readonly id: string
  readonly method: string
  readonly path: string
}

const groups = StarterApi.groups as Record<
  string,
  { readonly endpoints: Record<string, { method: string; path: string }> }
>

const endpoints: readonly ContractEndpoint[] = Object.entries(groups).flatMap(
  ([groupName, group]) =>
    Object.entries(group.endpoints).map(([endpointName, endpoint]) => ({
      id: `${groupName}.${endpointName}`,
      method: endpoint.method,
      path: endpoint.path
    }))
)

describe('contract ↔ router sync', () => {
  it('reflects the full contract surface', () => {
    // Guards against the reflection itself silently returning nothing.
    expect(endpoints.length).toBeGreaterThanOrEqual(19)
  })

  for (const endpoint of endpoints) {
    it(`routes ${endpoint.id} (${endpoint.method} ${endpoint.path})`, () => {
      const path = concretePath(endpoint.path)
      // Exactly one table entry owns each contract endpoint — an overlap here
      // is the method/path cross-product bug this table exists to prevent.
      const owners = routes.filter(
        (route) => route.method === endpoint.method && route.pattern.test(path)
      )
      expect(
        owners,
        `expected exactly one route for contract endpoint ${endpoint.id}`
      ).toHaveLength(1)

      const request = new Request(`http://localhost${path}`, {
        method: endpoint.method
      })
      const match = matchRoute(request, {})
      expect(match, `no route matches contract endpoint ${endpoint.id}`).not.toBeNull()
      // Workspace-scoped contracts must dispatch through the workspace seam
      // (WorkspaceContext resolution + 404 mapping live there).
      if (endpoint.path.startsWith('/workspaces/:slug')) {
        expect(match?.kind).toBe('workspace')
        if (match?.kind === 'workspace') {
          expect(match.slug).toBe(PARAM_SAMPLES['slug'])
        }
      }
      // Every contract route except the health check sits behind the bearer
      // gate — a route that loses its scope requirement is a security drift.
      if (endpoint.path !== '/health') {
        expect(
          match?.requiredScope,
          `${endpoint.id} lost its bearer scope requirement`
        ).toBeDefined()
      }
    })
  }

  it('has no route the contract does not define (except the OpenAPI/reference docs)', () => {
    const documented = new Set(['openapi', 'reference'])
    for (const route of routes) {
      if (typeof route.event === 'string' && documented.has(route.event)) continue
      const owned = endpoints.some(
        (endpoint) =>
          endpoint.method === route.method &&
          route.pattern.test(concretePath(endpoint.path))
      )
      expect(
        owned,
        `route ${route.method} ${route.pattern} matches no contract endpoint`
      ).toBe(true)
    }
  })
})
