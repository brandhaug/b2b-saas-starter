import { createClientOnlyFn } from '@tanstack/react-start'
import { ClientOnly, Link } from '@tanstack/react-router'
import { ArrowUpRightIcon, PauseIcon, PlayIcon } from 'lucide-react'
import { lazy, Suspense, useRef, useState } from 'react'
import { m } from '@b2b-saas-starter/i18n/messages'
import { Button } from '@/components/ui/button'
import { GITHUB_URL } from './github-url'
import { DecisionStack } from './decision-stack'

const loadLandingMotion = createClientOnlyFn(async () => {
  const motionModule = await import('./landing-motion')
  return motionModule
})
const LandingMotion = lazy(loadLandingMotion)
const STACK = [
  'TanStack Start',
  'Effect v4',
  'Drizzle D1',
  'Better Auth',
  'REST + MCP',
  'Cloudflare Workers',
  'Queues',
  'Email'
]
const PROOF = [
  {
    title: m.showcase_proof_shared,
    path: 'packages/capabilities',
    detail: m.showcase_proof_shared_detail,
    span: 'lg:col-span-7',
    href: `${GITHUB_URL}/tree/master/packages/capabilities`
  },
  {
    title: m.showcase_proof_contract,
    path: 'packages/api',
    detail: m.showcase_proof_contract_detail,
    span: 'lg:col-span-5',
    href: `${GITHUB_URL}/tree/master/packages/api`
  },
  {
    title: m.showcase_proof_runtime,
    path: 'apps/web · apps/background',
    detail: m.showcase_proof_runtime_detail,
    span: 'lg:col-span-5',
    href: `${GITHUB_URL}/blob/master/docs/setup.md`
  }
]

function ArsenalSection() {
  const [paused, setPaused] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  return (
    <section
      ref={sectionRef}
      aria-labelledby="arsenal-heading"
      className="border-t border-border"
    >
      <ClientOnly>
        <Suspense fallback={null}>
          <LandingMotion root={sectionRef} paused={paused} />
        </Suspense>
      </ClientOnly>
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 lg:py-32">
        <div className="max-w-2xl">
          <h2
            id="arsenal-heading"
            className="font-display text-balance text-4xl font-semibold sm:text-5xl"
          >
            {m.showcase_arsenal_heading()}
          </h2>
          <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
            {m.showcase_arsenal_description()}
          </p>
        </div>
        <div className="mt-12 grid gap-5 lg:grid-cols-12 lg:grid-flow-dense">
          {PROOF.map((proof) => (
            <a
              key={proof.path}
              href={proof.href}
              target="_blank"
              rel="noopener noreferrer"
              data-proof-card
              className={`group flex min-h-64 flex-col justify-between border border-border bg-card p-6 transition-colors hover:border-primary/60 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring sm:p-8 ${proof.span}`}
            >
              <div className="flex items-start justify-between gap-4">
                <span className="font-mono text-xs text-muted-foreground">
                  {proof.path}
                </span>
                <ArrowUpRightIcon
                  aria-hidden
                  className="size-5 shrink-0 text-primary transition-transform motion-safe:group-hover:translate-x-1 motion-safe:group-hover:-translate-y-1"
                />
              </div>
              <div>
                <h3 className="mt-10 text-xl font-semibold">{proof.title()}</h3>
                <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
                  {proof.detail()}
                </p>
              </div>
              <span className="sr-only">{m.common_opens_new_tab()}</span>
            </a>
          ))}
          <Link
            to="/demo"
            data-proof-card
            className="group overflow-hidden border border-border bg-card transition-colors hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring lg:col-span-7"
          >
            <div data-scale-image className="overflow-hidden border-b border-border">
              {/* oxlint-disable-next-line react-doctor/no-image-hover-transform -- The approved public design calls for image hover scaling on linked previews. */}
              <img
                src="/images/workspace-preview.png"
                alt=""
                width={1440}
                height={1000}
                loading="lazy"
                decoding="async"
                className="h-44 w-full object-cover object-top transition-transform duration-700 motion-safe:group-hover:scale-105 sm:h-52"
              />
            </div>
            <div className="p-6 sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <h3 className="text-xl font-semibold">{m.showcase_proof_demo()}</h3>
                <ArrowUpRightIcon
                  aria-hidden
                  className="size-5 shrink-0 text-primary"
                />
              </div>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
                {m.showcase_proof_demo_detail()}
              </p>
            </div>
          </Link>
        </div>
      </div>
      <div className="border-y border-border py-6">
        <div className="mx-auto mb-5 flex max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <p className="text-sm text-muted-foreground">{m.showcase_stack_label()}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={paused ? m.showcase_resume_stack() : m.showcase_pause_stack()}
            aria-pressed={paused}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? (
              <PlayIcon aria-hidden className="size-4" />
            ) : (
              <PauseIcon aria-hidden className="size-4" />
            )}
          </Button>
        </div>
        <div className="overflow-hidden">
          <div data-marquee className="flex w-max">
            <div className="flex shrink-0 items-center gap-12 pr-12 font-display text-3xl font-semibold sm:text-4xl">
              {STACK.map((name) => (
                <span key={name}>{name}</span>
              ))}
            </div>
            <div
              aria-hidden
              className="flex shrink-0 items-center gap-12 pr-12 font-display text-3xl font-semibold sm:text-4xl"
            >
              {STACK.map((name) => (
                <span key={name}>{name}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <DecisionStack />
    </section>
  )
}
export { ArsenalSection }
