import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GithubIcon } from '@/components/icons/github'
import { GITHUB_URL } from '@/lib/github-url'
import { SETUP_STEPS } from '@/lib/toolchain'
import { m } from '@b2b-saas-starter/i18n/messages'

function HeroSection() {
  return (
    <section className="relative isolate overflow-hidden border-b border-border">
      <div className="relative mx-auto max-w-7xl px-4 pt-16 pb-12 sm:px-6 lg:pt-24 lg:pb-16">
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
            <h1 className="rise rise-2 mt-5 font-display text-balance text-4xl font-semibold leading-display sm:text-5xl xl:text-6xl">
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

              <Button
                nativeButton={false}
                render={
                  <a
                    href={GITHUB_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={m.action_view_github()}
                  />
                }
                variant="outline"
                size="lg"
              >
                <GithubIcon className="size-4" />
                {m.action_view_github()}
                <span className="sr-only">{m.common_opens_new_tab()}</span>
              </Button>
            </div>
          </div>
          {/* The quickstart's real commands, one per line — not a
              copy-paste line that quietly skips the migrate and seed steps
              before it. `lib/toolchain.ts` holds them, and its test fails
              if they stop matching the quickstart verbatim. */}
          <ol
            aria-label={m.landing_quickstart_commands()}
            className="rise rise-4 w-full max-w-sm justify-self-start border border-border bg-card/40 font-mono text-xs lg:justify-self-stretch"
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
      </div>
    </section>
  )
}

export { HeroSection }
