import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GITHUB_URL } from '@/components/landing/github-url'
import { DEV_SERVERS, INSTALL_AND_RUN } from '@/lib/toolchain'

function ClosingSection({ workspaceSlug }: { readonly workspaceSlug: string }) {
  return (
    <section className="band-deep bg-background text-foreground">
      <div className="mx-auto grid max-w-7xl items-center gap-x-20 gap-y-12 px-4 py-24 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:py-28">
        <div>
          <h2 className="font-display text-balance text-3xl font-semibold sm:text-4xl">
            Fork it. It boots in two commands.
          </h2>
          <p className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground">
            MIT licensed. The reference application runs locally against a seed
            workspace: no Stripe key, no OAuth app, no email domain required.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              render={
                <Link to="/workspaces/$workspaceSlug" params={{ workspaceSlug }} />
              }
              size="lg"
            >
              Open the reference app
              <ArrowRightIcon className="size-4" />
            </Button>
            <Button render={<Link to="/docs" />} size="lg" variant="outline">
              Read the docs
            </Button>
          </div>
        </div>
        {/* A labelled "what you get" list, not a transcript: the real first
            lines of `pnpm run dev` are tool-specific and would drift. Every
            command here is real — see lib/toolchain.ts and its guard test. */}
        <dl className="overflow-x-auto border border-border bg-card p-5 font-mono text-xs leading-loose text-foreground/90">
          <div className="flex gap-3">
            <dt className="shrink-0 text-muted-foreground">$ git clone</dt>
            <dd>{GITHUB_URL}.git</dd>
          </div>
          <div className="flex gap-3">
            <dt className="shrink-0 text-muted-foreground">$ {INSTALL_AND_RUN}</dt>
            <dd className="sr-only">{INSTALL_AND_RUN}</dd>
          </div>
          {DEV_SERVERS.map((server) => (
            <div key={server.label} className="flex gap-3">
              <dt className="w-24 shrink-0 text-muted-foreground">{server.label}</dt>
              <dd>{server.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

export { ClosingSection }
