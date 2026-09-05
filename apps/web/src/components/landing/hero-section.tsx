import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GithubIcon } from '@/components/icons/github'
import { GITHUB_URL } from '@/components/landing/github-url'
import { SETUP_STEPS } from '@/lib/toolchain'

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

function HeroSection() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-7xl px-4 pt-16 pb-12 sm:px-6 lg:pt-28 lg:pb-16">
        {/* The schematic moved: it now works for the whole scroll as the
            sticky rail of the traced-request section below, instead of dying
            at this fold. The hero is the claim; the spine is the proof. The
            fold is two columns from `lg`: the claim and its actions on the
            left, the quickstart card holding the right half — the commands
            are the proof-of-work half of the pitch, so they earn fold space
            rather than trailing the lede. */}
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] lg:items-end lg:gap-16">
          <div className="max-w-2xl">
            <p className="rise font-mono text-sm text-signal-ink">
              A Cloudflare-first B2B SaaS starter
            </p>
            {/* `leading-display`: a display face at 5–6xl wants near-solid
                leading; `leading-tight` (1.25) opened air between lines the
                wordmark was never sized for. */}
            <h1 className="rise rise-2 mt-5 font-display text-balance text-5xl font-semibold leading-display sm:text-6xl">
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
                  is one sign-in away from there. No second "Sign in" button:
                  the header carries one on every scroll position, and a
                  second at the fold read as a duplicate control, not a
                  choice. */}
              <Button nativeButton={false} render={<Link to="/demo" />} size="lg">
                Open the live demo
                <ArrowRightIcon className="size-4" />
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
            </div>
          </div>
          {/* The quickstart's real commands, one per line — not a
              copy-paste line that quietly skips the migrate and seed steps
              before it. `lib/toolchain.ts` holds them, and its test fails
              if they stop matching the quickstart verbatim. */}
          <ol
            aria-label="Quickstart commands"
            className="rise rise-4 w-full max-w-sm justify-self-start border border-border bg-card font-mono text-xs lg:justify-self-stretch"
          >
            {SETUP_STEPS.map((step) => (
              <li
                key={step}
                className="flex items-baseline gap-2 border-b border-border px-3 py-1.5 text-foreground/90 last:border-b-0"
              >
                <span aria-hidden className="select-none text-muted-foreground">
                  $
                </span>
                <code>{step}</code>
              </li>
            ))}
          </ol>
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
