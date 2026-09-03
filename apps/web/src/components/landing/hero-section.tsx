import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GithubIcon } from '@/components/icons/github'
import { ArchitectureSchematic } from '@/components/landing/architecture-schematic'
import { GITHUB_URL } from '@/components/landing/github-url'
import { INSTALL_AND_RUN } from '@/lib/toolchain'

const BILL_OF_MATERIALS: ReadonlyArray<string> = [
  'TanStack Start',
  'Effect v4',
  'Drizzle D1',
  'Better Auth',
  'shadcn/ui',
  'Tailwind v4',
  'Cloudflare Workers',
  'Alchemy v2'
]

function HeroSection({ workspaceSlug }: { readonly workspaceSlug: string }) {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-7xl px-4 pt-16 pb-10 sm:px-6 lg:pt-24">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16">
          <div className="flex max-w-xl flex-col items-start">
            <p className="rise font-mono text-sm text-signal-ink">
              A Cloudflare-first B2B SaaS starter
            </p>
            <h1 className="rise rise-2 mt-5 font-display text-balance text-5xl font-semibold leading-none sm:text-6xl">
              The hard parts, already wired.
            </h1>
            <p className="rise rise-3 mt-6 text-pretty text-lg text-muted-foreground">
              Workspaces, auth, REST + MCP, webhooks, email, audit, and admin, typed
              end-to-end and proven by a working reference app. It boots locally with
              zero provider secrets.
            </p>
            <div className="rise rise-4 mt-9 flex flex-wrap items-center gap-3">
              {/* The demo tree renders the reference dashboard for the seed
                  workspace with no sign-in and no mutation path; the real app
                  is one sign-in away from there. */}
              <Button
                nativeButton={false}
                render={<Link to="/demo/$workspaceSlug" params={{ workspaceSlug }} />}
                size="lg"
              >
                Open the live demo
                <ArrowRightIcon className="size-4" />
              </Button>
              <Button
                nativeButton={false}
                render={<Link to="/sign-in" />}
                size="lg"
                variant="outline"
              >
                Sign in
              </Button>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center gap-2 border border-border bg-background px-5 text-sm font-medium transition-colors hover:bg-muted"
              >
                <GithubIcon className="size-4" />
                View on GitHub
                <span className="sr-only">(opens in new tab)</span>
              </a>
              <code className="font-mono text-xs text-muted-foreground max-sm:mt-2">
                $ {INSTALL_AND_RUN}
              </code>
            </div>
          </div>
          <figure
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- <figure> is the semantic element; role="region" exposes the scrollable area without losing figure semantics.
            role="region"
            aria-label="Architecture schematic, scrollable horizontally"
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need a focus stop to pan the horizontally overflowing schematic.
            tabIndex={0}
            className="rise rise-3 min-w-0 overflow-x-auto border border-border bg-card p-3 sm:p-4"
          >
            <ArchitectureSchematic />
            {/* Text alternative for the diagram's detail: the SVG is one
                image (role="img") whose 8–10px labels are not individually
                exposed, so the nodes and edges exist as a hidden list. */}
            <figcaption className="sr-only">
              Every label in this diagram is a real path in the repository.
            </figcaption>
            <dl className="sr-only">
              <div>
                <dt>Clients</dt>
                <dd>browser, curl / SDK, MCP client, queue jobs</dd>
              </div>
              <div>
                <dt>Workers</dt>
                <dd>
                  apps/web (TanStack Start), apps/api (REST + MCP), apps/background
                  (queue consumer)
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
              <div>
                <dt>Flows</dt>
                <dd>
                  browser to apps/web to capabilities to D1; REST and MCP clients to
                  apps/api to capabilities to D1; queue jobs to apps/background to
                  capabilities to Queues and Email
                </dd>
              </div>
            </dl>
          </figure>
        </div>
        <ul className="mt-14 flex flex-wrap gap-x-7 gap-y-2 border-t border-border pt-5 font-mono text-xs text-muted-foreground">
          {BILL_OF_MATERIALS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export { HeroSection }
