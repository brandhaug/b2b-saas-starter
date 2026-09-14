import { type WorkspaceOverviewProjection } from '@b2b-saas-starter/capabilities/workspace-projections'
import { seedWorkspaceRecord } from '@b2b-saas-starter/capabilities/governance/workspace-identity.seed'
import { useState } from 'react'
import { Tabs } from '@base-ui/react/tabs'
import { GITHUB_URL } from './github-url'
import {
  ArchitectureSchematic,
  type SchematicNode
} from '@/components/landing/architecture-schematic'
import { SnippetPanel } from '@/components/landing/snippet-panel'
import {
  CALL_SITES,
  CAPABILITY_SNIPPET,
  CONTRACT_SNIPPET
} from '@/components/landing/request-trace-snippets'
import { DEMO_WORKSPACE_SLUG } from '@/lib/demo-workspace'
import { DEPLOY_COMMAND } from '@/lib/toolchain'
import { m } from '@b2b-saas-starter/i18n/messages'

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

function stageLabel(stage: StageId): string {
  switch (stage) {
    case 'request': {
      return m.showcase_trace_request()
    }
    case 'contract': {
      return m.showcase_trace_contract()
    }
    case 'capability': {
      return m.showcase_trace_capability()
    }
    case 'runtime': {
      return m.showcase_trace_runtime()
    }
  }
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

const REQUEST_SNIPPET = `curl -H "Authorization: Bearer $API_TOKEN" \\\n  https://api.example.com/workspaces/${DEMO_WORKSPACE_SLUG}/overview`

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
  const [activeStage, setActiveStage] = useState<StageId>('request')

  const activeNodes = nodesForStage(activeStage)

  return (
    <section
      className="band-deep bg-background text-foreground"
      aria-labelledby="request-trace-heading"
    >
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-24">
        <div className="max-w-2xl">
          <h2
            id="request-trace-heading"
            className="font-display text-balance text-3xl font-semibold sm:text-4xl"
          >
            {m.public_request_heading()}
          </h2>
          <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
            {m.showcase_trace_description()}
          </p>
        </div>

        <Tabs.Root
          value={activeStage}
          onValueChange={(value) => {
            const stage = String(value)
            if (isStageId(stage)) {
              setActiveStage(stage)
            }
          }}
        >
          <Tabs.List
            aria-label={m.public_request_heading()}
            className="mt-8 flex gap-1 overflow-x-auto border-b border-border"
          >
            {STAGE_IDS.map((stage) => (
              <Tabs.Tab
                key={stage}
                value={stage}
                className="min-h-11 shrink-0 border-b-2 border-transparent px-4 py-3 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring data-active:border-primary data-active:text-foreground"
              >
                {stageLabel(stage)}
              </Tabs.Tab>
            ))}
          </Tabs.List>

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

          <div className="mt-8 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
            <div className="min-w-0">
              <Tabs.Panel
                value="request"
                className="pt-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
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
              </Tabs.Panel>

              <Tabs.Panel
                value="contract"
                className="pt-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <h3 className="mt-3 text-xl font-semibold text-balance">
                  {m.public_request_stage_contract()}
                </h3>
                <p className="mt-3 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
                  {m.public_request_stage_contract_description()}
                </p>
                <div className="mt-6">
                  <SnippetPanel
                    label={m.shell_trace_workspace_group()}
                    path={CONTRACT_SNIPPET.path}
                    code={CONTRACT_SNIPPET.code}
                  />
                </div>
              </Tabs.Panel>

              <Tabs.Panel
                value="capability"
                className="pt-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <h3 className="mt-3 text-xl font-semibold text-balance">
                  {m.public_request_stage_capability()}
                </h3>
                <p className="mt-3 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
                  {m.public_request_stage_capability_description()}
                </p>
                <div className="mt-6">
                  <SnippetPanel
                    label={m.shell_trace_overview()}
                    path={CAPABILITY_SNIPPET.path}
                    code={CAPABILITY_SNIPPET.code}
                  />
                </div>
                <ul className="mt-5 divide-y divide-border">
                  {CALL_SITES.map((site) => (
                    <li key={site.path}>
                      <a
                        href={`${GITHUB_URL}/blob/master/${site.path}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-3 text-sm underline underline-offset-4 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <span>{site.label}</span>
                        <span className="break-all font-mono text-xs text-muted-foreground">
                          {site.path}
                        </span>
                        <span className="sr-only">{m.common_opens_new_tab()}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </Tabs.Panel>

              <Tabs.Panel
                value="runtime"
                className="pt-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
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
                        <td className="break-all py-3 align-baseline font-mono text-xs text-muted-foreground">
                          {row.declared}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Tabs.Panel>
            </div>

            <div className="hidden lg:block">
              <div className="sticky top-24">
                <ArchitectureSchematic activeNodes={activeNodes} />
              </div>
            </div>
          </div>
          <figure className="mx-auto mt-10 max-w-md lg:hidden">
            <ArchitectureSchematic activeNodes={activeNodes} />
          </figure>
        </Tabs.Root>
      </div>
    </section>
  )
}

/**
 * What the request snippet prints when the showcase read came back empty
 * (this deployment has no seed workspace): the seed fixture's own values, so
 * the panel shows the payload's shape without claiming live data.
 */
const FALLBACK_OVERVIEW: WorkspaceOverviewProjection = {
  workspace: seedWorkspaceRecord,
  notifications: []
}

export { RequestTraceSection }
