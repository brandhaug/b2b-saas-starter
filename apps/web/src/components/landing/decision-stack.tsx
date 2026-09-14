import { useRef } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, ArrowUpRightIcon } from 'lucide-react'
import { m } from '@b2b-saas-starter/i18n/messages'
import { Button } from '@/components/ui/button'
import { GITHUB_URL } from './github-url'

const DECISIONS = [
  {
    id: 'shared',
    body: m.showcase_decision_one,
    source: m.showcase_decision_one_source,
    path: 'docs/adr/0037-shared-capabilities-package.md'
  },
  {
    id: 'providers',
    body: m.showcase_decision_two,
    source: m.showcase_decision_two_source,
    path: 'PRODUCT.md'
  },
  {
    id: 'identity',
    body: m.showcase_decision_three,
    source: m.showcase_decision_three_source,
    path: 'AGENTS.md'
  }
]

export function DecisionStack() {
  const rootRef = useRef<HTMLDivElement>(null)
  function select(index: number) {
    const anchors =
      rootRef.current?.querySelectorAll<HTMLElement>('[data-stack-anchor]')
    anchors?.item(index).scrollIntoView({ block: 'start', behavior: 'instant' })
  }
  return (
    <div ref={rootRef} className="mx-auto max-w-6xl px-4 py-24 sm:px-6 lg:py-32">
      <h2 className="max-w-2xl font-display text-balance text-3xl font-semibold sm:text-4xl">
        {m.showcase_decisions_label()}
      </h2>
      <div data-decision-stack className="mt-10">
        {DECISIONS.map((decision, index) => (
          <div
            key={decision.id}
            data-stack-anchor
            className="relative scroll-mt-32 pb-6"
            style={{ zIndex: index + 1 }}
          >
            <article
              data-stack-card
              className="relative flex min-h-80 flex-col justify-between border border-border bg-card p-6 sm:min-h-72 sm:p-10"
            >
              <p className="max-w-4xl font-display text-pretty text-2xl leading-tight font-medium sm:text-3xl lg:text-4xl">
                {decision.body()}
              </p>
              <div className="mt-8 flex flex-wrap items-end justify-between gap-6">
                <a
                  href={`${GITHUB_URL}/blob/master/${decision.path}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 max-w-lg items-center gap-2 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                >
                  {decision.source()}
                  <ArrowUpRightIcon aria-hidden className="size-4 shrink-0" />
                  <span className="sr-only">{m.common_opens_new_tab()}</span>
                </a>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">
                    {m.showcase_decision_position({
                      current: index + 1,
                      total: DECISIONS.length
                    })}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={m.showcase_previous_decision()}
                    disabled={index === 0}
                    onClick={() => select(index - 1)}
                  >
                    <ChevronLeftIcon aria-hidden className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={m.showcase_next_decision()}
                    disabled={index === DECISIONS.length - 1}
                    onClick={() => select(index + 1)}
                  >
                    <ChevronRightIcon aria-hidden className="size-4" />
                  </Button>
                </div>
              </div>
            </article>
          </div>
        ))}
      </div>
    </div>
  )
}
