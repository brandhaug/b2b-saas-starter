import { type WorkspaceOverviewProjection } from '@b2b-saas-starter/capabilities/workspace-projections'
import { useEffect, useRef, useState } from 'react'
import {
  ArchitectureSchematic,
  type SchematicNode
} from '@/components/landing/architecture-schematic'
import { SnippetPanel } from '@/components/landing/snippet-panel'
import { useOverflowFade } from '@/hooks/use-overflow-fade'
import { DEPLOY_COMMAND } from '@/lib/toolchain'
import { cn } from '@/lib/utils'

/**
 * Direction A of the landing redesign: one narrative spine that follows a
 * single request end to end. Each stage quotes real code from this
 * repository (path in the panel caption), and the sticky schematic in the
 * rail lights the node under discussion as the reader scrolls — the map and
 * the prose stay in lockstep. The highlighting is a color-state change, not
 * an entrance: every stage and the whole schematic are visible without it,
 * and `prefers-reduced-motion` only drops the color transition, never the
 * state.
 */

const STAGE_IDS = [
  'request',
  'contract',
  'capability',
  'runtime'
] satisfies ReadonlyArray<'request' | 'contract' | 'capability' | 'runtime'>
type StageId = (typeof STAGE_IDS)[number]

const STAGE_ID_SET: ReadonlySet<string> = new Set(STAGE_IDS)

function isStageId(value: string): value is StageId {
  return STAGE_ID_SET.has(value)
}

/** The node(s) each stage lights in the schematic rail. */
function nodesForStage(stage: StageId): ReadonlyArray<SchematicNode> {
  switch (stage) {
    case 'request': {
      return ['curl']
    }
    case 'contract': {
      return ['api']
    }
    case 'capability': {
      return ['capabilities']
    }
    case 'runtime': {
      return ['d1', 'queues', 'email']
    }
  }
}

/**
 * The request whose trace the section follows. The response body is built
 * from the live payload the route loader read — the same read that filled
 * the numbers strip — trimmed to the workspace object plus the first
 * notification, verbatim and pretty-printed, with a plain-text count of
 * everything elided (the count is the array's real length; the untruncated
 * bytes are what the demo dashboard renders).
 */
function responseSnippet(overview: WorkspaceOverviewProjection): string {
  const [first] = overview.notifications
  const elided = overview.notifications.length - (first === undefined ? 0 : 1)
  const body = JSON.stringify(
    {
      workspace: overview.workspace,
      notifications: first === undefined ? [] : [first]
    },
    null,
    2
  )
  return elided <= 0 ? body : `${body}\n… ${elided} more notifications`
}

const REQUEST_SNIPPET = `curl -H "Authorization: Bearer bsk_live_xxx" \\\n  https://api.example.com/workspaces/starter-lab/overview`

/** Verbatim from `packages/api/src/index.ts` (the group's first endpoint
 *  and the gate every endpoint in it rides; six sibling reads omitted). */
const CONTRACT_SNIPPET = `export const WorkspaceApi = HttpApiGroup.make('workspace')
  .add(
    HttpApiEndpoint.get('overview', '/workspaces/:slug/overview', {
      params: SlugParams,
      success: WorkspaceOverviewDto,
      error: WORKSPACE_ERRORS
    })
  )
  .middleware(BearerAuth)`

/** Verbatim from `packages/capabilities/src/workspace-projections.ts`. */
const CAPABILITY_SNIPPET = `export const workspaceOverview: Effect.Effect<
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

/**
 * The three call sites, each condensed to its deciding lines. `…` marks
 * elisions the same way the response snippet does; nothing is paraphrased.
 */
const CALL_SITES: ReadonlyArray<{
  readonly label: string
  readonly path: string
  readonly code: string
}> = [
  {
    label: 'server fn',
    path: 'apps/web/src/lib/server/demo-showcase.effects.ts',
    code: `return runWorkspaceCapabilities(
  DEMO_WORKSPACE_SLUG,
  Effect.all({ overview: workspaceOverview, memberCount: … })
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
    code: `const invoke = yield* decodeOperationInput(operation, payload)
yield* requirePermission(yield* callerPrincipal(caller), operation.permission)
return yield* invoke`
  }
]

/** The runtime the trace lands on, one row per lit schematic node. */
const RUNTIME_ROWS: ReadonlyArray<{
  readonly node: string
  readonly holds: string
  readonly declared: string
}> = [
  {
    node: 'D1',
    holds: 'SQLite: schema, migrations, seed rows',
    declared: 'packages/db'
  },
  {
    node: 'Queues',
    holds: 'Webhook deliveries with retries and backoff',
    declared: 'apps/background'
  },
  {
    node: 'Email',
    holds: 'Transactional sends, provider-gated until configured',
    declared: 'packages/email'
  }
]

function RequestTraceSection({
  overview
}: {
  /** The live `overview` payload; `null` prints the fixture's shape only. */
  readonly overview: WorkspaceOverviewProjection | null
}) {
  const sectionRef = useRef<HTMLElement | null>(null)
  const [activeStage, setActiveStage] = useState<StageId>('request')
  // The mobile schematic's width hides behind its horizontal scroll; the
  // fade mask marks the hidden width as scrollable while any of it remains.
  const { ref: schematicRef, fadeRight: schematicFadeRight } =
    useOverflowFade<HTMLElement>()

  // Which stage is "current" is decided by a focus band around the top third
  // of the viewport; the rail lights that stage's node. A keyboard reader
  // gets the same mapping through focus: landing in a stage's panel makes it
  // current without a scroll.
  useEffect(() => {
    const root = sectionRef.current
    if (root === null || !('IntersectionObserver' in window)) {
      return
    }
    const articles = [...root.querySelectorAll<HTMLElement>('[data-stage]')]
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue
          }
          const stage = entry.target.getAttribute('data-stage')
          if (stage !== null && isStageId(stage)) {
            setActiveStage(stage)
          }
        }
      },
      { rootMargin: '-25% 0px -65% 0px' }
    )
    for (const article of articles) {
      observer.observe(article)
    }
    return () => observer.disconnect()
  }, [])

  const activeNodes = nodesForStage(activeStage)

  return (
    <section ref={sectionRef} className="band-deep bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-24">
        <div className="max-w-2xl">
          <h2 className="font-display text-balance text-3xl font-semibold sm:text-4xl">
            One request, traced end to end.
          </h2>
          <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
            The same read that filled the numbers above, followed from the curl that
            starts it to the binding that persists it. Every excerpt below is real code
            from this repository; the caption on each panel is its path.
            <span className="hidden lg:inline">
              {' '}
              In the rail, the node under discussion lights as you read.
            </span>
          </p>
        </div>

        {/* The schematic as a map, not just an artifact: once, scrollable,
            above the spine on small screens; sticky at reduced scale beside
            it from `lg`. Identical drawing, one text alternative. The fade
            mask is on only while drawing hides past the right edge, so the
            hidden width reads as scrollable. */}
        <figure
          ref={schematicRef}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- <figure> is the semantic element; role="region" exposes the scrollable area without losing figure semantics.
          role="region"
          aria-label="Architecture schematic, scrollable horizontally"
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need a focus stop to pan the horizontally overflowing schematic.
          tabIndex={0}
          className={cn(
            'mt-10 min-w-0 overflow-x-auto border border-border bg-card p-3 lg:hidden',
            schematicFadeRight &&
              '[mask-image:linear-gradient(to_right,black_calc(100%_-_2.5rem),transparent_100%)]'
          )}
        >
          <ArchitectureSchematic activeNodes={activeNodes} />
        </figure>
        <dl className="sr-only">
          <div>
            <dt>Clients</dt>
            <dd>browser, curl / SDK, MCP client, queue jobs</dd>
          </div>
          <div>
            <dt>Workers</dt>
            <dd>
              apps/web (TanStack Start), apps/api (REST + MCP), apps/background (queue
              consumer)
            </dd>
          </div>
          <div>
            <dt>Shared layer</dt>
            <dd>packages/capabilities: every worker calls the same effects</dd>
          </div>
          <div>
            <dt>Infrastructure</dt>
            <dd>D1 (database), Queues (outbound webhooks), Email Service</dd>
          </div>
        </dl>

        <div className="mt-10 grid gap-x-16 gap-y-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
          <div
            className="min-w-0"
            onFocusCapture={(event) => {
              if (!(event.target instanceof Element)) {
                return
              }
              const stage = event.target
                .closest('[data-stage]')
                ?.getAttribute('data-stage')
              if (stage !== null && stage !== undefined && isStageId(stage)) {
                setActiveStage(stage)
              }
            }}
          >
            <article data-stage="request" className="pt-2">
              <StageMarker index="01" node="curl / SDK" />
              <h3 className="mt-3 text-xl font-semibold text-balance">The request</h3>
              <p className="mt-3 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
                An ordinary bearer-authenticated GET. The body printed below is the live
                overview this page rendered its numbers from, not a fixture: the first
                notification is shown in full and the rest are counted, never
                paraphrased.
              </p>
              <div className="mt-6">
                <SnippetPanel
                  label="REST · GET /workspaces/:slug/overview"
                  code={`${REQUEST_SNIPPET}\n\n${responseSnippet(overview ?? FALLBACK_OVERVIEW)}`}
                />
              </div>
            </article>

            <article
              data-stage="contract"
              className="mt-16 border-t border-border pt-10 lg:mt-24"
            >
              <StageMarker index="02" node="apps/api" />
              <h3 className="mt-3 text-xl font-semibold text-balance">The contract</h3>
              <p className="mt-3 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
                The route exists because the contract says it does. Path, params,
                success schema, and the typed error channel sit in one declaration:{' '}
                <code className="font-mono text-xs">WORKSPACE_ERRORS</code> is
                WorkspaceNotFound, Unauthorized, AuthorizationDenied, RateLimited,
                CapabilityUnavailable — encoded on the endpoint, not thrown as strings.
                The bearer gate rides the group, so a sibling endpoint cannot ship
                without it.
              </p>
              <div className="mt-6">
                <SnippetPanel
                  label="HttpApiEndpoint · the workspace group"
                  path="packages/api/src/index.ts"
                  code={CONTRACT_SNIPPET}
                />
              </div>
            </article>

            <article
              data-stage="capability"
              className="mt-16 border-t border-border pt-10 lg:mt-24"
            >
              <StageMarker index="03" node="packages/capabilities" />
              <h3 className="mt-3 text-xl font-semibold text-balance">
                The capability, written once
              </h3>
              <p className="mt-3 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
                Both surfaces call the same effect. Its failure channel and its service
                requirements are part of its type, so every caller shares one failure
                vocabulary and the compiler checks the wiring — the claim on this page
                that cannot be faked.
              </p>
              <div className="mt-6">
                <SnippetPanel
                  label="Effect · the overview projection"
                  path="packages/capabilities/src/workspace-projections.ts"
                  code={CAPABILITY_SNIPPET}
                />
              </div>
              {/* Three call sites, three deciding lines each: the same
                  effect serving a server fn, a REST handler, and an MCP
                  tool. Stacked full-width of the column — the widest line
                  (74 chars) fits unscrolled, so each reads as three lines,
                  not a panning exercise. */}
              <div className="mt-4 grid items-start gap-4">
                {CALL_SITES.map((site) => (
                  <SnippetPanel
                    key={site.label}
                    label={site.label}
                    path={site.path}
                    code={site.code}
                  />
                ))}
              </div>
            </article>

            <article
              data-stage="runtime"
              className="mt-16 border-t border-border pt-10 lg:mt-24"
            >
              <StageMarker index="04" node="D1 · Queues · Email" />
              <h3 className="mt-3 text-xl font-semibold text-balance">
                The runtime it lands on
              </h3>
              <p className="mt-3 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
                Every binding below the effect is declared once in{' '}
                <code className="font-mono text-xs">alchemy.run.ts</code>: the same
                TypeScript description provisions local dev and production, so the whole
                story ends in{' '}
                <code className="font-mono text-xs text-signal-ink">
                  {DEPLOY_COMMAND}
                </code>
                .
              </p>
              <table className="mt-6 w-full border-collapse text-left">
                <caption className="sr-only">
                  The three infrastructure bindings the trace ends in, one row per node
                  in the schematic
                </caption>
                <thead>
                  <tr className="border-b border-border font-mono text-2xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      binding
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      what it holds
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      declared in
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {RUNTIME_ROWS.map((row) => (
                    <tr key={row.node} className="border-b border-border">
                      <th
                        scope="row"
                        className="py-3 pr-4 align-baseline font-mono text-sm font-medium"
                      >
                        {row.node}
                      </th>
                      <td className="py-3 pr-4 align-baseline text-sm text-muted-foreground">
                        {row.holds}
                      </td>
                      <td className="py-3 align-baseline font-mono text-xs text-muted-foreground">
                        {row.declared}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          </div>

          {/* The sticky rail: the schematic's dense redraw, the node under
              discussion lit. Fixed 11px labels — see `DenseSchematic`. Pure
              color-state; nothing here gates content. */}
          <div className="hidden lg:block">
            <div className="sticky top-24 border border-border bg-card p-4">
              <ArchitectureSchematic
                variant="dense"
                activeNodes={activeNodes}
                className="w-full transition-colors duration-300"
              />
              <p className="mt-3 font-mono text-2xs text-muted-foreground">
                The lit node follows the stage.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function StageMarker({
  index,
  node
}: {
  readonly index: string
  readonly node: string
}) {
  // The sequence is the content: request, contract, capability, runtime is a
  // real order, so the counter carries information rather than decorating.
  return (
    <p className="font-mono text-2xs text-signal-ink">
      <span aria-hidden className="text-muted-foreground">
        {index} ·{' '}
      </span>
      {node}
    </p>
  )
}

/**
 * What the request snippet prints when the showcase read came back empty
 * (this deployment has no seed workspace): the seed fixture's own values, so
 * the panel shows the payload's shape without claiming live data.
 */
const FALLBACK_OVERVIEW: WorkspaceOverviewProjection = {
  workspace: {
    id: 'wrk_starter',
    slug: 'starter-lab',
    name: 'Starter Lab',
    planId: 'team'
  },
  notifications: []
}

export { RequestTraceSection }
