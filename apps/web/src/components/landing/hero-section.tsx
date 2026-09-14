import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GITHUB_URL } from '@/components/landing/github-url'
import { LightRays } from '@/components/landing/light-rays'
import { m } from '@b2b-saas-starter/i18n/messages'

function HeroSection() {
  return (
    <section className="relative isolate overflow-hidden border-b border-border">
      <img
        src="/images/showcase-infrastructure.webp"
        alt=""
        width="1920"
        height="1080"
        className="absolute inset-0 size-full object-cover grayscale opacity-20"
      />
      <div aria-hidden className="hero-backdrop pointer-events-none absolute inset-0" />
      <LightRays />
      <div className="relative mx-auto max-w-6xl px-4 py-20 text-center sm:px-6 lg:py-36">
        <div className="mx-auto max-w-6xl">
          <h1 className="hero-display rise mx-auto font-display text-balance font-semibold">
            {m.landing_headline()}
          </h1>
          <p className="rise rise-2 mx-auto mt-8 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">
            {m.landing_description()}
          </p>
          <div className="rise rise-3 mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button nativeButton={false} render={<Link to="/demo" />} size="lg">
              {m.action_open_demo()}
              <ArrowRightIcon className="size-4" />
            </Button>

            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-2 border border-border bg-background px-5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {m.action_view_github()}
              <span className="sr-only">{m.common_opens_new_tab()}</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

export { HeroSection }
