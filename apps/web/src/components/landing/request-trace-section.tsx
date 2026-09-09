import { type WorkspaceOverviewProjection } from '@b2b-saas-starter/capabilities/workspace-projections'
import { useEffect, useRef, useState } from 'react'
import {
  ArchitectureSchematic,
  type SchematicNode
} from '@/components/landing/architecture-schematic'
import { SnippetPanel } from '@/components/landing/snippet-panel'
import { DEPLOY_COMMAND } from '@/lib/toolchain'
import { m } from '@b2b-saas-starter/i18n/messages'

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
  return elided <= 0
    ? body
    : `${body}\n${m.public_request_more_notifications({ count: elided })}`
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
function runtimeRows(): ReadonlyArray<{
  readonly node: string
  readonly holds: string
  readonly declared: string
}> {
  return [
    {
      node: 'D1',
      holds: m.public_request_d1_holds(),
      declared: 'packages/db'
    },
    {
      node: 'Queues',
      holds: m.public_request_queues_holds(),
      declared: 'apps/background'
    },
    {
      node: 'Email',
      holds: m.public_request_email_holds(),
      declared: 'packages/email'
    }
  ]
}

function RequestTraceSection({
  overview
}: {
  /** The live `overview` payload; `null` prints the fixture's shape only. */
  readonly overview: WorkspaceOverviewProjection | null
}) {
  const sectionRef = useRef<HTMLElement | null>(null)
  const [activeStage, setActiveStage] = useState<StageId>('request')

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
            {m.public_request_heading()}
          </h2>
          <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
            {m.public_request_description()}
          </p>
        </div>

        <figure
          aria-label={m.public_architecture_aria()}
          className="mx-auto mt-10 max-w-md lg:hidden"
        >
          <ArchitectureSchematic activeNodes={activeNodes} />
        </figure>
        <dl className="sr-only">
          <div>
            <dt>{m.public_request_clients()}</dt>
            <dd>{m.public_request_clients_detail()}</dd>
          </div>
          <div>
            <dt>{m.public_request_workers()}</dt>
            <dd>{m.public_request_workers_detail()}</dd>
          </div>
          <div>
            <dt>{m.public_request_shared_layer()}</dt>
            <dd>{m.public_request_shared_detail()}</dd>
          </div>
          <div>
            <dt>{m.public_request_infrastructure()}</dt>
            <dd>{m.public_request_infrastructure_detail()}</dd>
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
              <StageMarker index="01" node="HTTP client" />
              <h3 className="mt-3 text-xl font-semibold text-balance">
                {m.public_request_stage_request()}
              </h3>
              <p className="mt-3 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
                {m.public_request_stage_request_description()}
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
              <h3 className="mt-3 text-xl font-semibold text-balance">
                {m.public_request_stage_contract()}
              </h3>
              <p className="mt-3 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
                {m.public_request_stage_contract_description()}
              </p>
              <div className="mt-6">
                <SnippetPanel
                  label={m.shell_trace_workspace_group()}
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
                {m.public_request_stage_capability()}
              </h3>
              <p className="mt-3 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
                {m.public_request_stage_capability_description()}
              </p>
              <div className="mt-6">
                <SnippetPanel
                  label={m.shell_trace_overview()}
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
                {m.public_request_stage_runtime()}
              </h3>
              <p className="mt-3 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
                {m.public_request_stage_runtime_description()}{' '}
                <code className="font-mono text-xs text-signal-ink">
                  {DEPLOY_COMMAND}
                </code>
                .
              </p>
              <table className="mt-6 w-full border-collapse text-left">
                <caption className="sr-only">{m.public_request_caption()}</caption>
                <thead>
                  <tr className="border-b border-border font-mono text-2xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {m.public_request_binding()}
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {m.public_request_holds()}
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      {m.public_request_declared_in()}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runtimeRows().map((row) => (
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

          <div className="hidden lg:block">
            <div className="sticky top-24">
              <ArchitectureSchematic activeNodes={activeNodes} />
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
