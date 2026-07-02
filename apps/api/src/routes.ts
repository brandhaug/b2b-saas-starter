import { Effect, type Scope } from 'effect'
import type { AssistantService } from '@b2b-saas-starter/ai'
import type { EmailDispatcher } from '@b2b-saas-starter/email'
import type {
  ApiTokenRegistry,
  ApiTokenScope,
  CapabilityUnavailable,
  CatalogRefreshHistory,
  StarterModuleCatalog
} from '@b2b-saas-starter/capabilities'
import { json, respond, type InvalidInput } from './http.ts'
import {
  createTokenEffect,
  createWebhookEffect,
  invitationEffect,
  revokeTokenEffect,
  workspaceResources,
  type WorkspaceResource,
  type WorkspaceServices
} from './handlers/workspace.ts'
import {
  answerAssistantEffect,
  catalogModulesHandler,
  catalogRefreshHistoryHandler,
  mcpDiscoverResponse
} from './handlers/standalone.ts'
import { openApiDocument } from './openapi.ts'
import { scalarReference } from './reference.ts'
import type { RateLimitBucket } from './rate-limit.ts'
import type { Env } from './index.ts'

export type WorkspaceRoute = {
  readonly kind: 'workspace'
  readonly event: string
  readonly slug: string
  readonly handle: () => Effect.Effect<
    Response,
    CapabilityUnavailable | InvalidInput,
    WorkspaceServices | EmailDispatcher | Scope.Scope
  >
  readonly rateLimit?: { readonly bucket: RateLimitBucket }
  readonly requiredScope?: ApiTokenScope
}

export type StandaloneRoute = {
  readonly kind: 'standalone'
  readonly event: string
  readonly handle: () => Effect.Effect<
    Response,
    CapabilityUnavailable | InvalidInput,
    | StarterModuleCatalog
    | CatalogRefreshHistory
    | ApiTokenRegistry
    | AssistantService
    | Scope.Scope
  >
  readonly rateLimit?: { readonly bucket: RateLimitBucket }
  readonly requiredScope?: ApiTokenScope
}

export type RouteMatch = WorkspaceRoute | StandaloneRoute

type Groups = Record<string, string | undefined>

type RouteContext = {
  readonly request: Request
  readonly env: Env
  readonly groups: Groups
}

type WorkspaceRouteDef = {
  readonly kind: 'workspace'
  readonly method: string
  readonly pattern: RegExp
  readonly event: string | ((groups: Groups) => string)
  readonly bucket: RateLimitBucket
  readonly scope: ApiTokenScope
  readonly make: (ctx: RouteContext) => ReturnType<WorkspaceRoute['handle']>
}

type StandaloneRouteDef = {
  readonly kind: 'standalone'
  readonly method: string
  readonly pattern: RegExp
  readonly event: string
  readonly bucket?: RateLimitBucket
  readonly scope?: ApiTokenScope
  readonly make: (ctx: RouteContext) => ReturnType<StandaloneRoute['handle']>
}

export type RouteDef = WorkspaceRouteDef | StandaloneRouteDef

const workspace = (def: Omit<WorkspaceRouteDef, 'kind'>): RouteDef => ({
  kind: 'workspace',
  ...def
})

const standalone = (def: Omit<StandaloneRouteDef, 'kind'>): RouteDef => ({
  kind: 'standalone',
  ...def
})

// Path alternation derived from the resource map — adding a resource there is
// the whole wiring. Every GET is a read: the api-tokens and webhooks lists
// return no secret material; mutations below require write/admin.
const workspaceResourcePattern = new RegExp(
  `^/workspaces/(?<slug>[^/]+)/(?<resource>${Object.keys(workspaceResources).join('|')})$`
)

export const routes: readonly RouteDef[] = [
  standalone({
    method: 'GET',
    pattern: /^\/health$/,
    event: 'health',
    make: () => Effect.succeed(json({ status: 'ok' }))
  }),
  standalone({
    method: 'GET',
    pattern: /^\/openapi\.json$/,
    event: 'openapi',
    make: () => Effect.succeed(json(openApiDocument))
  }),
  standalone({
    method: 'GET',
    pattern: /^\/reference$/,
    event: 'reference',
    make: () => Effect.succeed(scalarReference())
  }),
  workspace({
    method: 'GET',
    pattern: workspaceResourcePattern,
    event: (groups) => `workspace.${groups['resource']}`,
    bucket: 'rest_read',
    scope: 'read',
    make: ({ groups }) => {
      const resource: Effect.Effect<unknown, CapabilityUnavailable, WorkspaceServices> =
        workspaceResources[groups['resource'] as WorkspaceResource]
      return respond(resource)
    }
  }),
  workspace({
    method: 'POST',
    pattern: /^\/workspaces\/(?<slug>[^/]+)\/api-tokens$/,
    event: 'workspace.api-tokens.create',
    bucket: 'rest_write',
    scope: 'admin',
    make: ({ request }) => createTokenEffect(request)
  }),
  // The contract defines exactly `POST …/:tokenId/revoke` and
  // `DELETE …/:tokenId` — two explicit entries, no method/path cross-product.
  workspace({
    method: 'POST',
    pattern: /^\/workspaces\/(?<slug>[^/]+)\/api-tokens\/(?<tokenId>[^/]+)\/revoke$/,
    event: 'workspace.api-tokens.revoke',
    bucket: 'rest_write',
    scope: 'admin',
    make: ({ groups }) => revokeTokenEffect(groups['tokenId'] as string)
  }),
  workspace({
    method: 'DELETE',
    pattern: /^\/workspaces\/(?<slug>[^/]+)\/api-tokens\/(?<tokenId>[^/]+)$/,
    event: 'workspace.api-tokens.revoke',
    bucket: 'rest_write',
    scope: 'admin',
    make: ({ groups }) => revokeTokenEffect(groups['tokenId'] as string)
  }),
  workspace({
    method: 'POST',
    pattern: /^\/workspaces\/(?<slug>[^/]+)\/webhooks$/,
    event: 'workspace.webhooks.create',
    bucket: 'rest_write',
    scope: 'write',
    make: ({ request }) => createWebhookEffect(request)
  }),
  workspace({
    method: 'POST',
    pattern: /^\/workspaces\/(?<slug>[^/]+)\/invitations$/,
    event: 'workspace.invitations.send',
    bucket: 'invitations',
    scope: 'admin',
    make: ({ request, env }) => invitationEffect(request, env.CLOUDFLARE_EMAIL_FROM)
  }),
  standalone({
    method: 'GET',
    pattern: /^\/catalog\/modules$/,
    event: 'catalog.modules',
    bucket: 'rest_read',
    scope: 'read',
    make: () => catalogModulesHandler
  }),
  standalone({
    method: 'GET',
    pattern: /^\/catalog\/refresh-history$/,
    event: 'catalog.refresh-history',
    bucket: 'rest_read',
    scope: 'read',
    make: () => catalogRefreshHistoryHandler
  }),
  standalone({
    method: 'GET',
    pattern: /^\/mcp$/,
    event: 'mcp.discover',
    bucket: 'mcp',
    scope: 'read',
    make: () => Effect.succeed(mcpDiscoverResponse())
  }),
  standalone({
    method: 'POST',
    pattern: /^\/assistant\/answer$/,
    event: 'assistant.answer',
    bucket: 'assistant',
    // The assistant reads workspace/catalog data on the caller's behalf, so
    // it needs the same bearer gate as the REST reads it wraps.
    scope: 'read',
    make: ({ request, env }) => answerAssistantEffect(request, env)
  })
]

export const matchRoute = (request: Request, env: Env): RouteMatch | null => {
  const url = new URL(request.url)
  for (const route of routes) {
    if (route.method !== request.method) continue
    const matched = url.pathname.match(route.pattern)
    if (!matched) continue
    const groups: Groups = matched.groups ?? {}
    const event = typeof route.event === 'function' ? route.event(groups) : route.event
    const guards = {
      ...(route.bucket ? { rateLimit: { bucket: route.bucket } } : {}),
      ...(route.scope ? { requiredScope: route.scope } : {})
    }
    if (route.kind === 'workspace') {
      return {
        kind: 'workspace',
        event,
        // Workspace patterns always bind a `slug` group.
        slug: groups['slug'] as string,
        handle: () => route.make({ request, env, groups }),
        ...guards
      }
    }
    return {
      kind: 'standalone',
      event,
      handle: () => route.make({ request, env, groups }),
      ...guards
    }
  }
  return null
}
