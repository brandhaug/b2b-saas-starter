import { Link } from '@tanstack/react-router'
import { ArrowRightIcon, ClipboardIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/lib/button-variants'
import { cn } from '@/lib/utils'
import {
  CLONE_COMMAND,
  COPY_COMMAND,
  DEV_SERVERS,
  REPOSITORY_DIRECTORY,
  SETUP_STEPS
} from '@/lib/toolchain'
import { m } from '@b2b-saas-starter/i18n/messages'

function ClosingSection() {
  // The whole command block, one click into the clipboard: the clone line
  // plus every quickstart step, `&&`-joined so it pastes as one paste. Same
  // copy pattern as secret-reveal: await, confirm visibly, clear after 2s.
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<number | undefined>(undefined)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      window.clearTimeout(timer.current)
      timer.current = undefined
    }
  }, [])

  async function copyCommands() {
    // oxlint-disable-next-line effect/noTryCatch -- Clipboard is a browser platform boundary; refusals stay in the local presentation layer.
    try {
      await navigator.clipboard.writeText(COPY_COMMAND)
      if (!mounted.current) {
        return
      }
      setCopyStatus('copied')
    } catch {
      if (!mounted.current) {
        return
      }
      setCopyStatus('failed')
    }

    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      setCopyStatus('idle')
    }, 2000)
  }

  return (
    <section className="band-deep relative isolate overflow-hidden bg-background text-foreground">
      <div className="relative mx-auto grid max-w-7xl items-center gap-x-20 gap-y-12 px-4 py-24 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:py-28">
        <div>
          <h2 className="font-display text-balance text-3xl font-semibold sm:text-4xl">
            {m.landing_fork_headline({ count: SETUP_STEPS.length })}
          </h2>
          <p className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground">
            {m.landing_fork_description()}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/demo" className={buttonVariants({ size: 'lg' })}>
              {m.action_open_demo()}
              <ArrowRightIcon className="size-4" />
            </Link>

            <Link
              to="/docs"
              className={buttonVariants({ variant: 'outline', size: 'lg' })}
            >
              {m.action_read_docs()}
            </Link>
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
              <output
                aria-live="polite"
                className={cn(
                  'grid text-xs',
                  copyStatus === 'failed' ? 'text-destructive' : 'text-status-ok'
                )}
              >
                <span className="col-start-1 row-start-1">
                  {copyStatus === 'copied' ? m.action_copied() : null}
                  {copyStatus === 'failed' ? m.action_copy_commands_failed() : null}
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
          <section
            aria-label={m.landing_commands_region()}
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need a focus stop to pan the overflowing command list.
            tabIndex={0}
            className="overflow-x-auto border border-t-0 border-border bg-card/40"
          >
            <dl className="p-5 font-mono text-xs leading-loose text-foreground/90">
              <div className="flex gap-3">
                <dt className="shrink-0 text-muted-foreground">$ git clone</dt>
                <dd className="break-all">{CLONE_COMMAND.replace('git clone ', '')}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="shrink-0 text-muted-foreground">$ cd</dt>
                <dd>{REPOSITORY_DIRECTORY}</dd>
              </div>
              {SETUP_STEPS.map((step) => (
                <div key={step} className="flex gap-3">
                  <dt className="shrink-0 text-muted-foreground">$ {step}</dt>
                  <dd className="sr-only">{step}</dd>
                </div>
              ))}
              {DEV_SERVERS.map((server) => (
                <div key={server.label} className="flex gap-3">
                  <dt className="w-24 shrink-0 text-muted-foreground">
                    {server.label}
                  </dt>
                  <dd>{server.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </section>
  )
}

export { ClosingSection }
