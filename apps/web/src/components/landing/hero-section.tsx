import { LightRays } from '@/components/landing/light-rays'
import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { buttonVariants } from '@/lib/button-variants'
import { GithubIcon } from '@/components/icons/github'
import { GITHUB_URL } from '@/lib/github-url'
import { m } from '@b2b-saas-starter/i18n/messages'

function HeroSection() {
  return (
    <section className="relative isolate overflow-hidden border-b border-border">
      <LightRays />
      <div className="relative mx-auto max-w-7xl px-5 pt-12 pb-14 sm:px-6 sm:pt-20 sm:pb-20 lg:pt-24 lg:pb-24">
        <div className="max-w-6xl">
          <h1 className="rise font-display text-4xl leading-display font-medium text-balance break-words sm:text-6xl xl:text-7xl">
            {m.landing_headline()}
          </h1>
          <p className="rise rise-2 mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground sm:mt-8 sm:text-xl">
            {m.landing_description()}
          </p>
          <div className="rise rise-3 mt-8 flex flex-wrap items-center gap-3 sm:mt-10">
            <Link to="/demo" className={buttonVariants({ size: 'lg' })}>
              {m.action_open_demo()}
              <ArrowRightIcon className="size-4" />
            </Link>

            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'outline', size: 'lg' })}
            >
              <GithubIcon className="size-4" />
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
