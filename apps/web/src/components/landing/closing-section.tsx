import { Link } from '@tanstack/react-router'
import { ArrowRightIcon, ClipboardIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { LightRays } from '@/components/landing/light-rays'
import { DEV_SERVERS, CLONE_AND_SETUP_STEPS } from '@/lib/toolchain'
import { m } from '@b2b-saas-starter/i18n/messages'

function ClosingSection() {
  // The whole command block, one click into the clipboard: the clone line
  // plus every quickstart step, `&&`-joined so it pastes as one paste. Same
  // copy pattern as secret-reveal: await, confirm visibly, clear after 2s.
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<number | null>(null)
  const commandBlock = CLONE_AND_SETUP_STEPS.join(' && ')
  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
      }
    },
    []
  )
  async function copyCommands() {
    // oxlint-disable-next-line effect/noTryCatch -- Clipboard refusal is a local browser presentation state.
    try {
      await navigator.clipboard.writeText(commandBlock)
    } catch {
      setCopyStatus('failed')
      return
    }
    setCopyStatus('copied')
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
    }
    timer.current = window.setTimeout(() => {
      setCopyStatus('idle')
    }, 2000)
  }

  return (
    <section className="band-deep relative isolate overflow-hidden bg-background text-foreground">
      <LightRays origin="top" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-x-20 gap-y-12 px-4 py-24 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:py-32">
        <div>
          <h2 className="font-display text-balance text-4xl font-semibold sm:text-5xl">
            {m.landing_fork_headline({ count: CLONE_AND_SETUP_STEPS.length })}
          </h2>
          <p className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground">
            {m.landing_fork_description()}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button nativeButton={false} render={<Link to="/demo" />} size="lg">
              {m.action_open_demo()}
              <ArrowRightIcon className="size-4" />
            </Button>

            <Button
              nativeButton={false}
              render={<Link to="/docs" />}
              size="lg"
              variant="outline"
            >
              {m.action_read_docs()}
            </Button>
          </div>
        </div>
        {/* A labelled "what you get" list, not a transcript: the quickstart
            steps are the commands `docs/getting-started/quickstart.mdx`
            prints (see lib/toolchain.ts and its guard test), and the dev
            servers are what `pnpm run dev` boots. */}
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-4 border border-border bg-card/40 px-3 py-2">
            <p className="font-mono text-xs text-muted-foreground">
              {m.landing_clone_commands()}
            </p>
            <div className="flex items-center gap-2">
              {/* Always mounted, content swapped: a region whose text never
                  changes is never announced, and an opacity fade leaves the
                  text in the accessibility tree the whole time. The reserved
                  width keeps the row from reflowing when the word appears. */}
              <output aria-live="polite" className="grid text-xs text-status-ok">
                <span aria-hidden className="invisible col-start-1 row-start-1">
                  {m.action_copied()}
                </span>
                <span className="col-start-1 row-start-1">
                  {copyStatus === 'copied' ? m.action_copied() : ''}
                </span>
              </output>
              <Button
                variant="outline"
                size="icon-xs"
                aria-label={m.action_copy_commands()}
                onClick={() => void copyCommands()}
              >
                <ClipboardIcon className="size-3.5" />
              </Button>
            </div>
          </div>
          {copyStatus === 'failed' ? (
            <output className="block border-x border-border px-3 py-2 text-sm text-destructive">
              {m.evidence_copy_failed()}
            </output>
          ) : null}
          <dl
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- <dl> is the semantic element for the labelled command list; role="region" exposes the scrollable area without losing it.
            role="region"
            aria-label={m.landing_commands_region()}
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need a focus stop to pan the overflowing command list.
            tabIndex={0}
            className="overflow-x-auto border border-t-0 border-border bg-card/40 p-5 font-mono text-xs leading-loose text-foreground/90"
          >
            {CLONE_AND_SETUP_STEPS.map((step) => (
              <div key={step} className="flex gap-3">
                <dt className="shrink-0 text-muted-foreground">$ {step}</dt>
                <dd className="sr-only">{step}</dd>
              </div>
            ))}
            {DEV_SERVERS.map((server) => (
              <div key={server.label} className="flex gap-3">
                <dt className="w-24 shrink-0 text-muted-foreground">{server.label}</dt>
                <dd>{server.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}

export { ClosingSection }
