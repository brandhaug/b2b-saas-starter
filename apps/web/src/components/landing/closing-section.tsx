import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { GITHUB_URL } from '@/components/landing/github-url'

function ClosingSection({ workspaceSlug }: { readonly workspaceSlug: string }) {
  return (
    <section className="band-deep bg-background text-foreground">
      <div className="mx-auto grid max-w-7xl items-center gap-x-20 gap-y-12 px-4 py-24 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:py-28">
        <div>
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Fork it. It boots in two commands.
          </h2>
          <p className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground">
            MIT licensed. The reference application runs locally against a seed
            workspace: no Stripe key, no OAuth app, no email domain required.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/workspaces/$workspaceSlug"
              params={{ workspaceSlug }}
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
  )
}

export { ClosingSection }
