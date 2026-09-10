import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GithubIcon } from '@/components/icons/github'
import { GITHUB_URL } from '@/components/landing/github-url'
import { SETUP_STEPS } from '@/lib/toolchain'
import { m } from '@b2b-saas-starter/i18n/messages'

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
            <p className="rise font-mono text-sm text-muted-foreground">
              {m.landing_tagline()}
            </p>
            {/* `leading-display`: a display face at 5–6xl wants near-solid
                leading; `leading-tight` (1.25) opened air between lines the
                wordmark was never sized for. */}
            <h1 className="rise rise-2 mt-5 font-display text-balance text-5xl font-semibold leading-display sm:text-6xl">
              {m.landing_headline()}
            </h1>
            <p className="rise rise-3 mt-6 text-pretty text-lg text-muted-foreground">
              {m.landing_description()}
            </p>
            <div className="rise rise-4 mt-9 flex flex-wrap items-center gap-3">
              <Button nativeButton={false} render={<Link to="/demo" />} size="lg">
                {m.action_open_demo()}
                <ArrowRightIcon className="size-4" />
              </Button>

              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center gap-2 border border-border bg-background px-5 text-sm font-medium transition-colors hover:bg-muted"
              >
                <GithubIcon className="size-4" />
                {m.action_view_github()}
                <span className="sr-only">{m.common_opens_new_tab()}</span>
              </a>
            </div>
          </div>
          {/* The quickstart's real commands, one per line — not a
              copy-paste line that quietly skips the migrate and seed steps
              before it. `lib/toolchain.ts` holds them, and its test fails
              if they stop matching the quickstart verbatim. */}
          <ol
            aria-label={m.landing_quickstart_commands()}
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
