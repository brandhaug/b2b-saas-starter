import { StarterApi } from '@b2b-saas-starter/api'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/unstable/http'
import { HttpApiClient } from 'effect/unstable/httpapi'
import { Effect, Layer } from 'effect'

/**
 * The Typed SDK (CONTEXT.md): `@b2b-saas-starter/sdk`, the client derived
 * from the shared `StarterApi` HttpApi contract (ADR 0058). There is no
 * codegen step and no generated file — every path, query parameter, payload,
 * success schema, and error schema the API Worker serves is the one this
 * client encodes and decodes, at type-check time, so a contract change fails
 * this package's build instead of drifting at runtime.
 *
 * Two layers over the same derived client:
 *
 * - `makeStarterApiClient` — the Effect-native factory, for callers already
 *   running Effect. Its methods are Effects failing with the contract's own
 *   tagged error classes.
 * - `createStarterClient` — the plain promise-based client: a base URL plus
 *   an API Token in, promise-returning methods out, each paged list offering
 *   an async iterator that walks the Pages (ADR 0057) to exhaustion.
 */

/** The derived client shape for the whole `StarterApi` surface. */
export type StarterApiClient = HttpApiClient.ForApi<typeof StarterApi>

/** One bounded slice of a list read — the REST list endpoints' success shape. */
export type Page<T> = {
  readonly items: ReadonlyArray<T>
  readonly nextCursor: string | null
}

export type StarterClientOptions = {
  /** The API Worker's origin, e.g. `https://api.example.com`. */
  readonly baseUrl: string
  /** A workspace-scoped API Token, sent as `Authorization: Bearer …`. */
  readonly apiToken: string
}

/**
 * Attaches the API Token to every request the derived client sends. The
 * contract's `BearerAuth` middleware declares the security scheme; the
 * credential itself is a caller concern, so it rides on the HttpClient.
 */
function withBearerToken(
  apiToken: string
): (client: HttpClient.HttpClient) => HttpClient.HttpClient {
  return function mapRequestWithBearer(client: HttpClient.HttpClient) {
    return HttpClient.mapRequest(client, (request) =>
      HttpClientRequest.bearerToken(request, apiToken)
    )
  }
}

/**
 * The Effect-native client. Requires an `HttpClient` service in context —
 * compose `FetchHttpClient.layer` (or a custom transport) where you run it.
 */
export function makeStarterApiClient(
  options: StarterClientOptions
): Effect.Effect<StarterApiClient, never, HttpClient.HttpClient> {
  return HttpApiClient.make(StarterApi, {
    baseUrl: options.baseUrl,
    transformClient: withBearerToken(options.apiToken)
  })
}

/**
 * The transport layer the plain client runs on: the runtime's `fetch` by
 * default, or one the caller injected — which is how tests point the client
 * at the API worker's web handler without a network. The injected fetch is
 * provided *into* the layer's build context (the layer reads `Fetch` per
 * request from the context it merges), not beside it.
 */
function transportLayer(fetchImpl: typeof globalThis.fetch | undefined) {
  if (fetchImpl === undefined) {
    return FetchHttpClient.layer
  }
  return FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchImpl))
  )
}

/**
 * A paged list endpoint on the plain client: call it for one Page, or reach
 * for `.iterate(slug)` to walk every page — yielding items in the endpoint's
 * documented order and following `nextCursor` until the server says the
 * list is exhausted.
 */
export type PagedListFn<T> = {
  (
    slug: string,
    options?: {
      readonly limit?: number | undefined
      readonly cursor?: string | undefined
    }
  ): Promise<Page<T>>
  readonly iterate: (
    slug: string,
    options?: {
      readonly limit?: number | undefined
    }
  ) => AsyncGenerator<T, void, undefined>
}

/**
 * The success type of one derived-client method: what the contract's schema
 * decodes to, read off the client's own method type instead of restated here.
 */
type Success<
  Method extends (...args: never) => Effect.Effect<unknown, unknown, unknown>
> = Effect.Success<ReturnType<Method>>

/**
 * The item shapes, derived from the derived client's own method types —
 * never restated. A contract change that alters a served item type is a
 * type error here, which is the whole point of the derivation.
 */
export type MemberItem = Success<
  StarterApiClient['workspace']['members']
>['items'][number]
export type NotificationItem = Success<
  StarterApiClient['workspace']['notifications']
>['items'][number]
export type ApiTokenItem = Success<
  StarterApiClient['workspace']['api-tokens']
>['items'][number]
export type WebhookEndpointItem = Success<
  StarterApiClient['workspace']['webhooks']
>['items'][number]
export type AuditEventItem = Success<
  StarterApiClient['workspace']['audit-events']
>['items'][number]

/** One paged list endpoint's query, as the derived client request carries it. */
type ListQuery = {
  readonly cursor?: string
  readonly limit?: number
}

/** The page query under assembly: absent keys mean "not sent", not `undefined`. */
type MutablePageQuery = {
  cursor?: string
  limit?: number
}

/**
 * The plain promise-based client: paths, query parameters, payload shapes,
 * and response shapes are all derived from `StarterApi`; rejections carry
 * the contract's tagged error classes (a missing or unknown token rejects
 * with the `Unauthorized` error the contract declares, and so on).
 */
export type StarterClient = {
  readonly health: {
    readonly check: () => Promise<Success<StarterApiClient['health']['check']>>
  }
  readonly workspace: {
    readonly overview: (
      slug: string
    ) => Promise<Success<StarterApiClient['workspace']['overview']>>
    readonly members: PagedListFn<MemberItem>
    readonly notifications: PagedListFn<NotificationItem>
    readonly apiTokens: PagedListFn<ApiTokenItem>
    readonly webhooks: PagedListFn<WebhookEndpointItem>
    readonly auditEvents: PagedListFn<AuditEventItem>
  }
}

/**
 * Wraps a raw page fetch (which already carries the slug) in the paged
 * surface: callable for one Page, `.iterate(slug)` for the whole
 * collection.
 *
 * The iterator is promise-shaped on purpose — it is the async-iteration
 * seam the plain client exists to offer (CONTEXT.md Typed SDK), so the
 * Effect async-function rules are relaxed here, as in packages/logger's
 * own promise boundary.
 */
// oxlint-disable effect/noAsyncFunction, eslint/no-await-in-loop -- the async iterator is the API; see the comment above
function paged<T>(
  fetchPage: (
    slug: string,
    options?: {
      readonly limit?: number | undefined
      readonly cursor?: string | undefined
    }
  ) => Promise<Page<T>>
): PagedListFn<T> {
  async function* iterate(
    slug: string,
    iterateOptions?: {
      readonly limit?: number | undefined
    }
  ): AsyncGenerator<T, void, undefined> {
    let cursor: string | undefined = undefined
    for (let guard = 0; guard < 10_000; guard += 1) {
      const page = await fetchPage(slug, {
        limit: iterateOptions?.limit,
        cursor
      })
      for (const item of page.items) {
        yield item
      }
      if (page.nextCursor === null) {
        return
      }
      cursor = page.nextCursor
    }
    // A contract that never stops paging would spin forever — surface the
    // runaway instead of looping silently past ten thousand pages. The
    // iterator is promise-land, so there is no Effect channel to fail
    // through; a rejection is the only honest signal here.
    // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- promise-land runaway guard; see above
    throw new Error('paged walk did not terminate: nextCursor stayed non-null')
  }
  return Object.assign(fetchPage, { iterate })
}
// oxlint-enable effect/noAsyncFunction, eslint/no-await-in-loop

/**
 * Builds the plain client. The derived Effect client resolves lazily on the
 * first call, and `fetch` may be injected so tests can point the client at
 * the API worker's web handler without a network.
 */
export function createStarterClient(
  options: StarterClientOptions & {
    readonly fetch?: typeof globalThis.fetch | undefined
  }
): StarterClient {
  const layer = transportLayer(options.fetch)
  let clientPromise: Promise<StarterApiClient> | undefined
  function client(): Promise<StarterApiClient> {
    clientPromise ??= Effect.runPromise(
      Effect.provide(makeStarterApiClient(options), layer)
    )
    return clientPromise
  }

  /** Runs one derived-client call to its decoded promise. */
  function run<A, E>(
    select: (resolved: StarterApiClient) => Effect.Effect<A, E, never>
  ): Promise<A> {
    return client().then((resolved) => Effect.runPromise(select(resolved)))
  }

  function pagedListFn<T>(
    select: (
      resolved: StarterApiClient
    ) => (request: {
      readonly params: { readonly slug: string }
      readonly query: ListQuery
    }) => Effect.Effect<Page<T>, unknown, never>
  ): PagedListFn<T> {
    return paged((slug, pageOptions) => {
      // Assembled per-field rather than spread: the derived request shape
      // treats an absent key differently from an explicit `undefined`
      // (exactOptionalPropertyTypes). The query object itself is required —
      // an empty one means "first page, default limit".
      const assembled: MutablePageQuery = {}
      if (pageOptions?.cursor !== undefined) {
        assembled.cursor = pageOptions.cursor
      }
      if (pageOptions?.limit !== undefined) {
        assembled.limit = pageOptions.limit
      }
      return run((resolved) => select(resolved)({ params: { slug }, query: assembled }))
    })
  }

  return {
    health: {
      check: () => run((resolved) => resolved.health.check())
    },
    workspace: {
      overview: (slug) =>
        run((resolved) => resolved.workspace.overview({ params: { slug } })),
      members: pagedListFn((resolved) => resolved.workspace.members),
      notifications: pagedListFn((resolved) => resolved.workspace.notifications),
      apiTokens: pagedListFn((resolved) => resolved.workspace['api-tokens']),
      webhooks: pagedListFn((resolved) => resolved.workspace.webhooks),
      auditEvents: pagedListFn((resolved) => resolved.workspace['audit-events'])
    }
  }
}
