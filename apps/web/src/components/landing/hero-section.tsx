import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { GithubIcon } from '@/components/icons/github'
import { ArchitectureSchematic } from '@/components/landing/architecture-schematic'
import { GITHUB_URL } from '@/components/landing/github-url'

const BILL_OF_MATERIALS: readonly string[] = [
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
    <section className="grid-paper border-b border-border">
      <div className="mx-auto max-w-7xl px-4 pt-16 pb-10 sm:px-6 lg:pt-24">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16">
          <div className="flex max-w-xl flex-col items-start">
            <p className="rise font-mono text-sm text-signal-ink">
              A Cloudflare-first B2B SaaS starter
            </p>
            <h1 className="rise rise-2 mt-5 text-balance text-5xl font-semibold leading-none tracking-tight sm:text-6xl">
              The hard parts, already wired.
            </h1>
            <p className="rise rise-3 mt-6 text-pretty text-lg text-muted-foreground">
              Workspaces, auth, REST + MCP, webhooks, email, billing wiring, audit, and
              reports, typed end-to-end and proven by a working reference app. It boots
              locally with zero provider secrets.
            </p>
            <div className="rise rise-4 mt-9 flex flex-wrap items-center gap-3">
              <Link
                to="/workspaces/$workspaceSlug"
                params={{ workspaceSlug }}
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
  )
}

export { HeroSection }
