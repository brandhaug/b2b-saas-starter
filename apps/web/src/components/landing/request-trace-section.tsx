import { type WorkspaceOverviewProjection } from '@b2b-saas-starter/capabilities/workspace-projections'
import { seedWorkspaceRecord } from '@b2b-saas-starter/capabilities/governance/workspace-identity.seed'
import { ArrowRightIcon, ChevronDownIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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

const STAGE_NODES = {
  request: ['curl'],
  contract: ['api'],
  capability: ['web', 'api', 'capabilities'],
  runtime: ['web', 'api', 'background', 'd1', 'durable-objects', 'queues', 'email']
} satisfies Record<string, ReadonlyArray<SchematicNode>>
type StageId = keyof typeof STAGE_NODES

function isStageId(value: string): value is StageId {
  return Object.hasOwn(STAGE_NODES, value)
}

function traceStages(): ReadonlyArray<{
  readonly id: StageId
  readonly label: string
}> {
  return [
    { id: 'request', label: m.showcase_trace_request() },
    { id: 'contract', label: m.showcase_trace_contract() },
    { id: 'capability', label: m.showcase_trace_capability() },
    { id: 'runtime', label: m.showcase_trace_runtime() }
  ]
}

// The response comes from the same projection as the showcase counts.
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

function runtimeRows() {
  return [
    {
      node: 'Workers',
      holds: m.showcase_workers_role(),
      declared: 'apps/web · apps/api · apps/background'
    },
    { node: 'D1', holds: m.public_request_d1_holds(), declared: 'packages/db' },
    {
      node: 'Durable Objects',
      holds: m.public_request_do_holds(),
      declared: 'apps/web · WorkspaceAssistantConversation'
    },
    {
      node: 'Queues',
      holds: m.public_request_queues_holds(),
      declared: 'apps/background'
    },
    { node: 'Email', holds: m.public_request_email_holds(), declared: 'packages/email' }
  ]
}

function RequestTraceSection({
  overview
}: {
  readonly overview: WorkspaceOverviewProjection | null
}) {
  const sectionRef = useRef<HTMLElement | null>(null)
  const [activeStage, setActiveStage] = useState<StageId>('request')

  useEffect(() => {
    const root = sectionRef.current
    if (root === null || !('IntersectionObserver' in window)) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const stage = entry.target.getAttribute('data-stage')
          if (entry.isIntersecting && stage !== null && isStageId(stage)) {
            setActiveStage(stage)
          }
        }
      },
      { rootMargin: '-25% 0px -65% 0px' }
    )
    for (const article of root.querySelectorAll('[data-stage]')) {
      observer.observe(article)
    }
    return () => observer.disconnect()
  }, [])

  return (
    <section
      ref={sectionRef}
      aria-labelledby="request-trace-heading"
      className="border-t border-border"
      onFocusCapture={(event) => {
        if (!(event.target instanceof Element)) {
          return
        }
        const stage = event.target.closest('[data-stage]')?.getAttribute('data-stage')
        if (stage !== null && stage !== undefined && isStageId(stage)) {
          setActiveStage(stage)
        }
      }}
    >
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-6 sm:py-24">
        <div className="max-w-3xl">
          <h2
            id="request-trace-heading"
            className="font-display text-4xl font-medium leading-display sm:text-5xl"
          >
            {m.public_request_heading()}
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
            {m.public_request_description()}
          </p>
        </div>

        <div className="mt-12 grid items-start gap-12 lg:mt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16">
          <div className="lg:sticky lg:top-24">
            <nav aria-label={m.showcase_trace_navigation()}>
              <ol className="grid grid-cols-2 gap-x-4 lg:grid-cols-1">
                {traceStages().map((stage, index) => (
                  <li key={stage.id}>
                    <a
                      href={`#request-${stage.id}`}
                      aria-current={activeStage === stage.id ? 'step' : undefined}
                      onClick={() => setActiveStage(stage.id)}
                      className="flex min-h-11 items-center gap-3 border-b border-border py-3 text-sm text-muted-foreground hover:text-foreground aria-current:font-medium aria-current:text-signal"
                    >
                      <span className="font-mono text-xs">{index + 1}</span>
                      {stage.label}
                      {activeStage === stage.id ? (
                        <ArrowRightIcon aria-hidden className="ml-auto size-4" />
                      ) : null}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
            <figure className="mt-6 hidden lg:block">
              <ArchitectureSchematic activeNodes={STAGE_NODES[activeStage]} />
            </figure>
            <details className="mt-4 lg:hidden">
              <summary className="min-h-11 cursor-pointer py-3 text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">
                {m.showcase_trace_view_architecture()}
              </summary>
              <figure className="mx-auto max-w-sm">
                <ArchitectureSchematic activeNodes={STAGE_NODES[activeStage]} />
              </figure>
            </details>
          </div>

          <div className="min-w-0">
            <article id="request-request" data-stage="request" className="scroll-mt-24">
              <h3 className="text-2xl font-medium leading-snug sm:text-3xl">
                {m.public_request_stage_request()}
              </h3>
              <p className="mt-2 text-2xl leading-snug text-muted-foreground sm:text-3xl">
                {m.public_request_stage_request_description()}
              </p>
              <div className="mt-8">
                <SnippetPanel
                  label="REST · GET /workspaces/:slug/overview"
                  code={`${REQUEST_SNIPPET}\n\n${responseSnippet(overview ?? FALLBACK_OVERVIEW)}`}
                />
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {overview === null
                  ? m.showcase_trace_fixture_note()
                  : m.showcase_trace_response_note()}
              </p>
            </article>

            <article
              id="request-contract"
              data-stage="contract"
              className="mt-16 scroll-mt-24 border-t border-border pt-12 sm:mt-24 sm:pt-16"
            >
              <h3 className="text-2xl font-medium leading-snug sm:text-3xl">
                {m.public_request_stage_contract()}
              </h3>
              <p className="mt-2 text-2xl leading-snug text-muted-foreground sm:text-3xl">
                {m.public_request_stage_contract_description()}
              </p>
              <div className="mt-8">
                <SnippetPanel
                  label={m.shell_trace_workspace_group()}
                  path={CONTRACT_SNIPPET.path}
                  code={CONTRACT_SNIPPET.code}
                />
              </div>
            </article>

            <article
              id="request-capability"
              data-stage="capability"
              className="mt-16 scroll-mt-24 border-t border-border pt-12 sm:mt-24 sm:pt-16"
            >
              <h3 className="text-2xl font-medium leading-snug sm:text-3xl">
                {m.public_request_stage_capability()}
              </h3>
              <p className="mt-2 text-2xl leading-snug text-muted-foreground sm:text-3xl">
                {m.public_request_stage_capability_description()}
              </p>
              <div className="mt-8">
                <SnippetPanel
                  label={m.shell_trace_overview()}
                  path={CAPABILITY_SNIPPET.path}
                  code={CAPABILITY_SNIPPET.code}
                />
              </div>
              <details className="group mt-4 border-b border-border">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-medium marker:hidden focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                  {m.showcase_trace_compare_callers()}
                  <ChevronDownIcon
                    aria-hidden
                    className="size-4 shrink-0 transition-transform motion-reduce:transition-none group-open:rotate-180"
                  />
                </summary>
                <div className="grid gap-4 pb-6">
                  {CALL_SITES.map((site) => (
                    <SnippetPanel
                      key={site.label}
                      label={site.label}
                      path={site.path}
                      code={site.code}
                    />
                  ))}
                </div>
              </details>
            </article>

            <article
              id="request-runtime"
              data-stage="runtime"
              className="mt-16 scroll-mt-24 border-t border-border pt-12 sm:mt-24 sm:pt-16"
            >
              <h3 className="text-2xl font-medium leading-snug sm:text-3xl">
                {m.public_request_stage_runtime()}
              </h3>
              <p className="mt-2 text-2xl leading-snug text-muted-foreground sm:text-3xl">
                {m.public_runtime_description()}
              </p>
              <dl className="mt-8 border-t border-border">
                {runtimeRows().map((row) => (
                  <div
                    key={row.node}
                    className="grid gap-2 border-b border-border py-5 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-6"
                  >
                    <dt className="font-mono text-sm font-medium text-signal">
                      {row.node}
                    </dt>
                    <dd>
                      <p className="text-sm leading-relaxed">{row.holds}</p>
                      <p className="mt-2 font-mono text-xs text-muted-foreground">
                        {row.declared}
                      </p>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-5 text-sm text-muted-foreground">
                <code className="font-mono text-foreground">{DEPLOY_COMMAND}</code>
              </p>
            </article>
          </div>
        </div>
      </div>
    </section>
  )
}

const FALLBACK_OVERVIEW: WorkspaceOverviewProjection = {
  workspace: seedWorkspaceRecord,
  notifications: []
}

export { RequestTraceSection }
