import { createFileRoute, Link } from '@tanstack/react-router'
import { Effect } from 'effect'
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  GitBranchIcon,
  SearchIcon
} from 'lucide-react'
import { GithubIcon } from '@/components/icons/github'
import { lazy, Suspense } from 'react'
import { CodeBlock } from '@/components/code-block'
import { FeatureCard } from '@/components/landing/feature-card'
import { SectionHeading } from '@/components/landing/section-heading'

const MiniBarChart = lazy(() =>
  import('@/components/landing/mini-bar-chart').then((m) => ({
    default: m.MiniBarChart
  }))
)
import { PublicLayout } from '@/components/public-layout'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getAllPosts } from '@/lib/blog'
import { runWorkspaceCapabilities } from '@/lib/capabilities'
import { architectureNodes, optionalProviderModules } from '@/lib/content'
import { getAllDocs } from '@/lib/docs'
import { StarterModuleCatalog, WorkspaceContext } from '@b2b-saas-starter/capabilities'

const SHOWCASE_SLUG = 'starter-lab'

export const Route = createFileRoute('/')({
  loader: () =>
    runWorkspaceCapabilities(
      SHOWCASE_SLUG,
      Effect.gen(function* () {
        const catalog = yield* StarterModuleCatalog
        const ctx = yield* WorkspaceContext
        const modules = yield* catalog.listModules
        return {
          workspace: ctx.workspace,
          modules
        }
      })
    ),
  component: HomePage,
  head: () => ({
    meta: [
      { title: 'B2B SaaS Starter — Cloudflare-first production starter' },
      {
        name: 'description',
        content:
          'A reference B2B SaaS starter with TanStack Start, Effect v4, Drizzle D1, Better Auth, REST and MCP, Cloudflare Email, Stripe-ready billing, audit events, and Storybook.'
      },
      { property: 'og:title', content: 'B2B SaaS Starter' },
      {
        property: 'og:description',
        content:
          'A reference B2B SaaS starter with TanStack Start, Effect v4, Drizzle D1, Better Auth, REST and MCP, Cloudflare Email, Stripe-ready billing, audit events, and Storybook.'
      }
    ]
  })
})

const EVENTS_PER_MINUTE = [
  { minute: 'm-5', count: 142 },
  { minute: 'm-4', count: 168 },
  { minute: 'm-3', count: 211 },
  { minute: 'm-2', count: 189 },
  { minute: 'm-1', count: 234 },
  { minute: 'm-0', count: 256 }
]

const REST_SNIPPET = `curl -H "Authorization: Bearer bsk_live_xxx" \\
  https://api.example.com/workspaces/starter-lab/overview

{
  "workspace": { "slug": "starter-lab", "name": "Starter Lab" },
  "readinessScore": 84,
  "modules": [],
  "notifications": []
}`

const MCP_SNIPPET = `{
  "name": "b2b-saas-starter-mcp",
  "resources": ["workspace://starter-lab/overview"],
  "tools": []
}`

const WIDE_EVENT_SNIPPET = `{
  "ts": "2026-05-16T10:42:13.918Z",
  "service": "apps/api",
  "route": "GET /workspaces/starter-lab/overview",
  "workspaceSlug": "starter-lab",
  "userId": "usr_01HXY...",
  "tokenId": "tok_01HXY...",
  "durationMs": 27,
  "status": 200,
  "traceId": "01HXY..."
}`

const CLOUDFLARE_RUNTIME = [
  { label: 'apps/web', value: 'Worker' },
  { label: 'apps/api', value: 'Worker' },
  { label: 'apps/background', value: 'Worker (cron + queue)' },
  { label: 'Database', value: 'D1' },
  { label: 'Outbound webhooks', value: 'Queues' },
  { label: 'Outbound email', value: 'Email Service' },
  { label: 'Static assets', value: 'Worker Assets' },
  { label: 'Infrastructure', value: 'Alchemy v2' }
]

const RECENT_POSTS = getAllPosts().slice(0, 3)
const RECENT_DOCS = getAllDocs().slice(0, 4)

function HomePage() {
  const { workspace, modules } = Route.useLoaderData()

  return (
    <PublicLayout>
      <main id="main-content">
        <section className="border-b border-border">
          <div className="mx-auto flex min-h-[calc(100svh-4rem)] max-w-5xl flex-col justify-center gap-8 px-4 py-20 sm:px-6">
            <Badge variant="secondary" className="w-fit">
              Cloudflare-first production starter
            </Badge>
            <div className="flex flex-col gap-6">
              <h1 className="text-balance text-5xl font-semibold tracking-tight sm:text-6xl lg:text-7xl">
                Inspect a B2B SaaS starter that ships with the hard parts wired.
              </h1>
              <p className="max-w-3xl text-pretty text-lg text-muted-foreground sm:text-xl">
                TanStack Start, Effect v4, Drizzle D1, Better Auth, REST and MCP,
                Cloudflare Email, webhooks, admin, audit, Storybook, Vitest, Playwright,
                oxlint, oxfmt, and Turbo — in one coherent repo.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/workspaces/$workspaceSlug"
                params={{ workspaceSlug: workspace.slug }}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
              >
                Open reference app
                <ArrowRightIcon className="size-4" />
              </Link>
              <Link
                to="/docs"
                className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium"
              >
                Read the docs
              </Link>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Architecture map
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                The homepage is a working stack showcase, not a fictional SaaS landing
                page.
              </p>
            </div>
            <GitBranchIcon className="size-5 text-muted-foreground" />
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {architectureNodes.map((node) => (
              <Card key={node.id}>
                <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                  <span className="grid size-9 place-items-center rounded-md bg-muted">
                    <node.icon className="size-4" />
                  </span>
                  <CardTitle className="text-base">{node.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{node.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="border-t border-border bg-muted/20 px-4 py-16 sm:py-20">
          <SectionHeading
            badge="Starter Modules"
            title="What's wired by default"
            description="Each module ships with production-ready surfaces and a Module State that the workspace can configure."
          />
          <div className="mx-auto mt-10 grid max-w-7xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((module) => (
              <FeatureCard
                key={module.id}
                title={module.name}
                description={module.summary}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{module.category}</span>
                  <StatusBadge status={module.state.status} />
                </div>
              </FeatureCard>
            ))}
          </div>
        </section>

        <section className="border-t border-border bg-muted/20 px-4 py-16 sm:py-20">
          <SectionHeading
            badge="Capability Interfaces"
            title="REST endpoints and MCP discovery from one set of services"
            description="The API Worker exposes REST endpoints and an MCP discovery resource from the same capability layer. Tool execution can be added without duplicating business behavior."
          />
          <div className="mx-auto mt-10 grid max-w-7xl gap-4 lg:grid-cols-2">
            <CodeBlock language="bash" code={REST_SNIPPET} />
            <CodeBlock language="json" code={MCP_SNIPPET} />
          </div>
          <div className="mx-auto mt-4 max-w-7xl text-center">
            <Link
              to="/docs/$category/$slug"
              params={{ category: 'capability-interfaces', slug: 'rest-api' }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Read the API contract
              <ArrowRightIcon className="size-3" />
            </Link>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20">
          <SectionHeading
            badge="Cloudflare-First"
            title="One platform, one deploy command"
            description="Alchemy v2 declares every resource: Workers, D1, Queues, Email Service. The same description provisions local and production."
          />
          <div className="mx-auto mt-10 grid max-w-4xl gap-2 sm:grid-cols-2">
            {CLOUDFLARE_RUNTIME.map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3"
              >
                <span className="text-sm font-medium">{row.label}</span>
                <span className="text-xs text-muted-foreground">{row.value}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-border bg-muted/20 px-4 py-16 sm:py-20">
          <SectionHeading
            badge="Optional Provider Modules"
            title="Real wiring, env-gated activation"
            description="Each provider is wired into the starter. None of them are required to run locally — missing configuration keeps the module inactive without breaking anything."
          />
          <div className="mx-auto mt-10 grid max-w-7xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {optionalProviderModules.map((provider) => (
              <div
                key={provider.id}
                className="flex items-start gap-3 rounded-lg border border-border bg-card p-4"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted">
                  <provider.icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{provider.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{provider.role}</p>
                  <Badge variant="secondary" className="mt-2 text-[10px]">
                    Env-gated
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-border bg-muted/20 px-4 py-16 sm:py-20">
          <SectionHeading
            badge="Observability"
            title="Wide events, audit events, optional Sentry"
            description="One canonical log line per request, persisted Audit Events for governance, and env-gated Sentry and PostHog when you want them."
          />
          <div className="mx-auto mt-10 grid max-w-7xl gap-4 lg:grid-cols-[1.1fr_1fr]">
            <CodeBlock language="json" code={WIDE_EVENT_SNIPPET} />
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="mb-2 text-sm font-medium">Events per minute</p>
              <p className="mb-3 text-xs text-muted-foreground">
                Across the three Workers (illustrative).
              </p>
              <Suspense fallback={<div className="h-[180px]" />}>
                <MiniBarChart
                  data={EVENTS_PER_MINUTE}
                  xKey="minute"
                  dataKey="count"
                  color="var(--chart-2)"
                />
              </Suspense>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20">
          <SectionHeading
            badge="Public Knowledge Content"
            title="Docs, blog, FAQ — checked in as MDX"
            description="Searched from generated indexes, rendered by the same MDX pipeline. No CMS, no database-backed marketing content."
          />
          <div className="mx-auto mt-10 max-w-3xl">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
              <SearchIcon className="size-4" />
              Search docs, blog, FAQ…
              <kbd className="ml-auto rounded border border-border bg-muted px-1.5 py-0.5 text-[10px]">
                ⌘K
              </kbd>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {RECENT_DOCS.map((doc) => (
                <Link
                  key={`${doc.category}/${doc.slug}`}
                  to="/docs/$category/$slug"
                  params={{ category: doc.category, slug: doc.slug }}
                  className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40"
                >
                  <p className="text-sm font-medium">{doc.frontmatter.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {doc.frontmatter.description}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-border bg-muted/20 px-4 py-16 sm:py-20">
          <SectionHeading
            badge="From the blog"
            title="Why we made the calls we made"
            description="Articles about the technology and library decisions in this starter."
          />
          <div className="mx-auto mt-10 grid max-w-7xl gap-4 sm:grid-cols-3">
            {RECENT_POSTS.map((post) => (
              <Link
                key={post.slug}
                to="/blog/$slug"
                params={{ slug: post.slug }}
                className="group flex flex-col gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40"
              >
                <p className="text-sm font-medium group-hover:text-primary">
                  {post.frontmatter.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {post.frontmatter.description}
                </p>
                <time className="mt-auto pt-2 text-xs text-muted-foreground">
                  {new Date(post.frontmatter.date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </time>
              </Link>
            ))}
          </div>
        </section>

        <section className="border-t border-border bg-card px-4 py-20 sm:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Fork, run, deploy.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
              MIT licensed. The Reference Application boots locally with no external
              provider configuration.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                to="/workspaces/$workspaceSlug"
                params={{ workspaceSlug: workspace.slug }}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
              >
                Open reference app
                <ArrowRightIcon className="size-4" />
              </Link>
              <Link
                to="/docs"
                className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium"
              >
                Read the docs
              </Link>
              <a
                href="https://github.com/brandhaug/full-stack-typescript-monorepo-starter-with-authentication"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium"
              >
                <GithubIcon className="size-4" />
                View on GitHub
              </a>
            </div>
          </div>
        </section>
      </main>
    </PublicLayout>
  )
}

function StatusBadge({ status }: { readonly status: string }) {
  const ready = status === 'ready'
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs">
      {ready ? (
        <CheckCircle2Icon className="size-3 text-chart-2" />
      ) : (
        <CircleDotIcon className="size-3 text-chart-5" />
      )}
      {status}
    </span>
  )
}
