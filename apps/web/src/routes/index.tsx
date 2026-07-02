import { createFileRoute, Link } from '@tanstack/react-router'
import { Effect } from 'effect'
import { ArrowRightIcon } from 'lucide-react'
import { GithubIcon } from '@/components/icons/github'
import { ArchitectureSchematic } from '@/components/landing/architecture-schematic'
import { PublicLayout } from '@/components/public-layout'
import { getAllPosts } from '@/lib/blog'
import { runWorkspaceCapabilities } from '@/lib/capabilities'
import { optionalProviderModules } from '@/lib/content'
import { DEMO_WORKSPACE_SLUG } from '@/lib/demo-workspace'
import { getAllDocs } from '@/lib/docs'
import { StarterModuleCatalog, WorkspaceContext } from '@b2b-saas-starter/capabilities'

export const Route = createFileRoute('/')({
  // Public showcase: no actor — a trusted server-side read of the demo
  // workspace, not a user-scoped one.
  loader: () =>
    runWorkspaceCapabilities(
      DEMO_WORKSPACE_SLUG,
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

const GITHUB_URL =
  'https://github.com/brandhaug/full-stack-typescript-monorepo-starter-with-authentication'

const BILL_OF_MATERIALS = [
  'TanStack Start',
  'Effect v4',
  'Drizzle D1',
  'Better Auth',
  'shadcn/ui',
  'Tailwind v4',
  'Cloudflare Workers',
  'Alchemy v2'
] as const

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

const CLOUDFLARE_RUNTIME = [
  { label: 'apps/web', value: 'Worker' },
  { label: 'apps/api', value: 'Worker' },
  { label: 'apps/background', value: 'Worker (cron + queue)' },
  { label: 'Database', value: 'D1' },
  { label: 'Outbound webhooks', value: 'Queues' },
  { label: 'Outbound email', value: 'Email Service' },
  { label: 'Static assets', value: 'Worker Assets' },
  { label: 'Infrastructure', value: 'Alchemy v2' }
] as const

const DISABLED_STATUS_META = {
  dot: 'border border-muted-foreground/70 bg-transparent',
  text: 'text-muted-foreground'
} as const

const MODULE_STATUS_META: Record<
  string,
  { readonly dot: string; readonly text: string }
> = {
  ready: { dot: 'bg-primary', text: 'text-foreground' },
  'needs-config': { dot: 'bg-signal', text: 'text-signal-ink' },
  attention: { dot: 'bg-destructive', text: 'text-destructive' },
  disabled: DISABLED_STATUS_META
}

const RECENT_POSTS = getAllPosts().slice(0, 3)
const RECENT_DOCS = getAllDocs().slice(0, 4)

function HomePage() {
  const { workspace, modules } = Route.useLoaderData()

  return (
    <PublicLayout>
      <main id="main-content">
        {/* ————— Hero: the claim, and the schematic that proves it ————— */}
        <section className="grid-paper border-b border-border">
          <div className="mx-auto max-w-7xl px-4 pt-16 pb-10 sm:px-6 lg:pt-24">
            <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16">
              <div className="flex max-w-xl flex-col items-start">
                <p className="rise font-mono text-sm text-signal-ink">
                  A Cloudflare-first B2B SaaS starter
                </p>
                <h1 className="rise rise-2 mt-5 text-balance text-5xl font-semibold leading-[1.04] tracking-tight sm:text-6xl">
                  The hard parts, already wired.
                </h1>
                <p className="rise rise-3 mt-6 text-pretty text-lg text-muted-foreground">
                  Workspaces, auth, REST + MCP, webhooks, email, billing wiring, audit,
                  and reports — typed end-to-end and proven by a working reference app.
                  It boots locally with zero provider secrets.
                </p>
                <div className="rise rise-4 mt-9 flex flex-wrap items-center gap-3">
                  <Link
                    to="/workspaces/$workspaceSlug"
                    params={{ workspaceSlug: workspace.slug }}
                    className="inline-flex h-11 items-center gap-2 bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    Open the reference app
                    <ArrowRightIcon className="size-4" />
                  </Link>
                  <a
                    href={GITHUB_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-11 items-center gap-2 border border-border bg-background px-5 text-sm font-medium transition-colors hover:bg-muted"
                  >
                    <GithubIcon className="size-4" />
                    View on GitHub
                  </a>
                  <code className="font-mono text-xs text-muted-foreground max-sm:mt-2">
                    $ bun install && bun run dev
                  </code>
                </div>
              </div>
              <figure className="rise rise-3 overflow-x-auto border border-border bg-background/85 p-3 sm:p-4">
                <ArchitectureSchematic />
                <figcaption className="sr-only">
                  Every label in this diagram is a real path in the repository.
                </figcaption>
              </figure>
            </div>
            <ul className="mt-14 flex flex-wrap gap-x-7 gap-y-2 border-t border-border pt-5 font-mono text-xs text-muted-foreground">
              {BILL_OF_MATERIALS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* ————— Module manifest: live seed data, not copy ————— */}
        <section className="mx-auto max-w-7xl px-4 pt-20 pb-24 sm:px-6 lg:pt-28">
          <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-4">
            <h2 className="max-w-md text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              {modules.length} starter modules, read live.
            </h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Read at request time from the{' '}
              <span className="font-mono text-signal-ink">{workspace.slug}</span> seed
              workspace, through the same capability layer the reference app uses.
            </p>
          </div>
          <table className="mt-10 w-full border-t border-border text-left">
            <caption className="sr-only">
              Starter modules and their current module state in the seed workspace
            </caption>
            <thead>
              <tr className="border-b border-border font-mono text-[11px] text-muted-foreground">
                <th scope="col" className="w-10 py-2 pr-4 font-normal max-sm:hidden">
                  #
                </th>
                <th scope="col" className="py-2 pr-4 font-normal">
                  module
                </th>
                <th scope="col" className="py-2 pr-4 font-normal max-md:hidden">
                  category
                </th>
                <th scope="col" className="py-2 font-normal">
                  state
                </th>
              </tr>
            </thead>
            <tbody>
              {modules.map((module, index) => {
                const meta =
                  MODULE_STATUS_META[module.state.status] ?? DISABLED_STATUS_META
                return (
                  <tr
                    key={module.id}
                    className="border-b border-border transition-colors hover:bg-accent/40"
                  >
                    <td className="py-3.5 pr-4 font-mono text-xs text-muted-foreground max-sm:hidden">
                      {String(index + 1).padStart(2, '0')}
                    </td>
                    <td className="max-w-xl py-3.5 pr-4">
                      <p className="text-sm font-medium">{module.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {module.summary}
                      </p>
                    </td>
                    <td className="py-3.5 pr-4 text-xs text-muted-foreground max-md:hidden">
                      {module.category}
                    </td>
                    {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the status text is right here, one span deep */}
                    <td className="py-3.5">
                      <span className="inline-flex items-center gap-2">
                        <span className={`size-2 shrink-0 ${meta.dot}`} />
                        <span className={`font-mono text-xs ${meta.text}`}>
                          {module.state.status}
                        </span>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        {/* ————— Drench: the capability layer ————— */}
        <section className="band-deep bg-background text-foreground">
          <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:py-28">
            <div className="max-w-2xl">
              <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                Write the capability once. Serve it three ways.
              </h2>
              <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
                Server functions in the web app, REST endpoints, and MCP discovery all
                call the same typed services in{' '}
                <code className="font-mono text-sm text-signal">
                  packages/capabilities
                </code>
                . No duplicated business behavior, no drift between surfaces.
              </p>
            </div>
            <div className="mt-12 grid gap-4 lg:grid-cols-2">
              <SnippetPanel
                label="REST · GET /workspaces/:slug/overview"
                code={REST_SNIPPET}
              />
              <SnippetPanel label="MCP · discovery" code={MCP_SNIPPET} />
            </div>
            <Link
              to="/docs/$category/$slug"
              params={{ category: 'capability-interfaces', slug: 'rest-api' }}
              className="mt-8 inline-flex items-center gap-1.5 text-sm text-foreground underline-offset-4 hover:underline"
            >
              Read the API contract
              <ArrowRightIcon className="size-3.5" />
            </Link>
          </div>
        </section>

        {/* ————— Runtime map ————— */}
        <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
          <div className="grid gap-x-20 gap-y-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div>
              <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                One platform. One deploy.
              </h2>
              <p className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground">
                Every resource is declared as TypeScript in{' '}
                <code className="font-mono text-xs">alchemy.run.ts</code> — Workers, D1,
                Queues, Email, secrets. The same description provisions local dev and
                production, so the whole story is{' '}
                <code className="font-mono text-xs text-signal-ink">
                  bun run deploy
                </code>
                .
              </p>
            </div>
            <dl className="grid content-start gap-x-12 sm:grid-cols-2">
              {CLOUDFLARE_RUNTIME.map((row) => (
                <div
                  key={row.label}
                  className="flex items-baseline justify-between gap-4 border-b border-border py-3"
                >
                  <dt className="text-sm font-medium">{row.label}</dt>
                  <dd className="font-mono text-xs text-muted-foreground">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ————— Provider patch bay ————— */}
        <section className="border-t border-border bg-muted/40">
          <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
            <div className="max-w-2xl">
              <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                Every provider is optional.
              </h2>
              <p className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground">
                Stripe, Sentry, PostHog, Email, and GitHub OAuth ship with real routes,
                models, and settings that stay inactive until their env vars exist.
                Local development never blocks on a provider account.
              </p>
            </div>
            <div className="mt-12 grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
              {optionalProviderModules.map((provider, index) => (
                <div
                  key={provider.id}
                  className={`flex flex-col gap-6 bg-background p-5 ${
                    index === optionalProviderModules.length - 1
                      ? 'sm:col-span-2 lg:col-span-1'
                      : ''
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <provider.icon className="size-4 text-muted-foreground" />
                    <p className="text-sm font-medium">{provider.name}</p>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {provider.role}
                  </p>
                  <p className="mt-auto inline-flex items-center gap-2">
                    <span className="size-2 rounded-full border border-signal-ink" />
                    <span className="font-mono text-[11px] text-signal-ink">
                      env-gated
                    </span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ————— Knowledge: docs + decisions ————— */}
        <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            The reasoning is checked in.
          </h2>
          <p className="mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
            Docs, FAQ, blog, and changelog are versioned MDX in the repo — searched from
            generated indexes, no CMS. The blog explains why each technology call was
            made.
          </p>
          <div className="mt-12 grid gap-x-20 gap-y-14 lg:grid-cols-2">
            <div>
              <p className="border-b border-border pb-3 font-mono text-xs text-muted-foreground">
                docs/
              </p>
              <ul>
                {RECENT_DOCS.map((doc) => (
                  <li key={`${doc.category}/${doc.slug}`}>
                    <Link
                      to="/docs/$category/$slug"
                      params={{ category: doc.category, slug: doc.slug }}
                      className="group flex items-baseline justify-between gap-6 border-b border-border py-4 transition-colors hover:bg-accent/40"
                    >
                      <span>
                        <span className="block text-sm font-medium group-hover:text-primary">
                          {doc.frontmatter.title}
                        </span>
                        <span className="mt-1 line-clamp-1 block text-xs text-muted-foreground">
                          {doc.frontmatter.description}
                        </span>
                      </span>
                      <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="border-b border-border pb-3 font-mono text-xs text-muted-foreground">
                blog/
              </p>
              <ul>
                {RECENT_POSTS.map((post) => (
                  <li key={post.slug}>
                    <Link
                      to="/blog/$slug"
                      params={{ slug: post.slug }}
                      className="group block border-b border-border py-4 transition-colors hover:bg-accent/40"
                    >
                      <span className="flex items-baseline justify-between gap-6">
                        <span className="text-sm font-medium group-hover:text-primary">
                          {post.frontmatter.title}
                        </span>
                        <time className="shrink-0 font-mono text-[11px] text-muted-foreground">
                          {new Date(post.frontmatter.date).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric'
                          })}
                        </time>
                      </span>
                      <span className="mt-1 line-clamp-1 block text-xs text-muted-foreground">
                        {post.frontmatter.description}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ————— Closing: fork it ————— */}
        <section className="band-deep bg-background text-foreground">
          <div className="mx-auto grid max-w-7xl items-center gap-x-20 gap-y-12 px-4 py-24 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:py-28">
            <div>
              <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                Fork it. It boots in two commands.
              </h2>
              <p className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground">
                MIT licensed. The reference application runs locally against a seed
                workspace — no Stripe key, no OAuth app, no email domain required.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to="/workspaces/$workspaceSlug"
                  params={{ workspaceSlug: workspace.slug }}
                  className="inline-flex h-11 items-center gap-2 bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Open the reference app
                  <ArrowRightIcon className="size-4" />
                </Link>
                <Link
                  to="/docs"
                  className="inline-flex h-11 items-center border border-border px-5 text-sm font-medium transition-colors hover:bg-accent"
                >
                  Read the docs
                </Link>
              </div>
            </div>
            <pre className="overflow-x-auto border border-border bg-card p-5 font-mono text-xs leading-loose text-foreground/90">
              <code>{`$ git clone ${GITHUB_URL}.git
$ bun install && bun run dev

  web        http://localhost:3071
  api        wired
  background wired
  providers  env-gated — nothing to configure`}</code>
            </pre>
          </div>
        </section>
      </main>
    </PublicLayout>
  )
}

function SnippetPanel({
  label,
  code
}: {
  readonly label: string
  readonly code: string
}) {
  return (
    <figure className="min-w-0 border border-border bg-card">
      <figcaption className="border-b border-border px-4 py-2 font-mono text-[11px] text-muted-foreground">
        {label}
      </figcaption>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-foreground/90">
        <code>{code}</code>
      </pre>
    </figure>
  )
}
