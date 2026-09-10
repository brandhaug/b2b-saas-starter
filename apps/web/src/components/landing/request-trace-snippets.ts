/**
 * Every code panel the request-trace section prints, each tied to the file it
 * quotes. The section renders `code` under `path`, so the pair is a claim
 * about this repository; the colocated test reads each file and fails when a
 * quoted line stops existing. Lines are verbatim apart from `…`, which marks
 * an elision and nothing else — no paraphrase, no invented API.
 */
export type TraceSnippet = {
  readonly path: string
  readonly code: string
}

/** The group's first endpoint and the gate every endpoint in it rides. */
export const CONTRACT_SNIPPET: TraceSnippet = {
  path: 'packages/api/src/index.ts',
  code: `export const WorkspaceApi = HttpApiGroup.make('workspace')
  .add(
    HttpApiEndpoint.get('overview', '/workspaces/:slug/overview', {
      params: SlugParams,
      success: WorkspaceOverviewDto,
      error: WORKSPACE_ERRORS
    })
  )
  .middleware(BearerAuth)`
}

export const CAPABILITY_SNIPPET: TraceSnippet = {
  path: 'packages/capabilities/src/workspace-projections.ts',
  code: `export const workspaceOverview: Effect.Effect<
  WorkspaceOverviewProjection,
  CapabilityUnavailable,
  WorkspaceContext | NotificationFeed
> = Effect.gen(function* () {
  const ctx = yield* WorkspaceContext
  const feed = yield* NotificationFeed
  const notifications = yield* feed.list
  return {
    workspace: ctx.workspace,
    notifications
  }
})`
}

/** The three call sites of that one capability, each condensed to its deciding lines. */
export const CALL_SITES: ReadonlyArray<TraceSnippet & { readonly label: string }> = [
  {
    label: 'server fn',
    path: 'apps/web/src/lib/server/demo-showcase.effects.ts',
    code: `return runWorkspaceCapabilities(
  DEMO_WORKSPACE_SLUG,
  Effect.all(
    {
      overview: workspaceOverview,
      …
    },
    { concurrency: 'unbounded' }
  )
)`
  },
  {
    label: 'REST handler',
    path: 'apps/api/src/handlers.ts',
    code: `.handle('overview', ({ params, request }) =>
  workspaceRead(READ_OPERATIONS.overview, params, undefined, request)
)`
  },
  {
    label: 'MCP tool',
    path: 'apps/api/src/mcp.ts',
    code: `const caller = yield* requireCaller()
const invoke = yield* decodeOperationInput(operation, payload)
…
const guarded = Effect.gen(function* () {
  yield* authorizeMcpOperation(caller, operation.permission, MCP_READ_SCOPE)
  return yield* invoke
}).pipe(Effect.scoped)`
  }
]

/** Every panel whose caption names a repository file, for the guard test. */
export const QUOTED_SNIPPETS: ReadonlyArray<TraceSnippet> = [
  CONTRACT_SNIPPET,
  CAPABILITY_SNIPPET,
  ...CALL_SITES
]
