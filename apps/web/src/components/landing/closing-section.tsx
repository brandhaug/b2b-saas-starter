import { Link } from '@tanstack/react-router'
import { ArrowRightIcon, ClipboardIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { GITHUB_URL } from '@/components/landing/github-url'
import { DEV_SERVERS, SETUP_STEPS } from '@/lib/toolchain'

function ClosingSection() {
  // The whole command block, one click into the clipboard: the clone line
  // plus every quickstart step, `&&`-joined so it pastes as one paste. Same
  // copy pattern as secret-reveal: await, confirm visibly, clear after 2s.
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  const commandBlock = `git clone ${GITHUB_URL}.git && ${SETUP_STEPS.join(' && ')}`
  async function copyCommands() {
    await navigator.clipboard.writeText(commandBlock)
    setCopied(true)
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
    }
    timer.current = window.setTimeout(() => {
      setCopied(false)
    }, 2000)
  }

  return (
    <section className="band-deep bg-background text-foreground">
      <div className="mx-auto grid max-w-7xl items-center gap-x-20 gap-y-12 px-4 py-24 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:py-28">
        <div>
          <h2 className="font-display text-balance text-3xl font-semibold sm:text-4xl">
            Fork it. Local in {SETUP_STEPS.length} commands.
          </h2>
          <p className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground">
            MIT licensed. The reference application runs locally against a seed
            workspace: no Stripe key, no OAuth app, no email domain required.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button nativeButton={false} render={<Link to="/demo" />} size="lg">
              Open the live demo
              <ArrowRightIcon className="size-4" />
            </Button>
            <Button
              nativeButton={false}
              render={<Link to="/docs" />}
              size="lg"
              variant="outline"
            >
              Read the docs
            </Button>
          </div>
        </div>
        {/* A labelled "what you get" list, not a transcript: the quickstart
            steps are the commands `docs/getting-started/quickstart.mdx`
            prints (see lib/toolchain.ts and its guard test), and the dev
            servers are what `pnpm run dev` boots. */}
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-4 border border-border bg-card px-3 py-2">
            <p className="font-mono text-xs text-muted-foreground">
              clone and quickstart
            </p>
            <div className="flex items-center gap-2">
              {/* Always-mounted so the change is announced when it flips. */}
              <output
                aria-live="polite"
                className={`text-xs text-status-ok transition-opacity duration-200 ${
                  copied ? 'opacity-100' : 'opacity-0'
                }`}
              >
                Copied
              </output>
              <Button
                variant="outline"
                size="icon-xs"
                aria-label="Copy the clone and quickstart commands"
                onClick={() => void copyCommands()}
              >
                <ClipboardIcon className="size-3.5" />
              </Button>
            </div>
          </div>
          <dl
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- <dl> is the semantic element for the labelled command list; role="region" exposes the scrollable area without losing it.
            role="region"
            aria-label="Clone and quickstart commands, scrollable"
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need a focus stop to pan the overflowing command list.
            tabIndex={0}
            className="overflow-x-auto border border-t-0 border-border bg-card p-5 font-mono text-xs leading-loose text-foreground/90"
          >
            <div className="flex gap-3">
              <dt className="shrink-0 text-muted-foreground">$ git clone</dt>
              <dd>{GITHUB_URL}.git</dd>
            </div>
            {SETUP_STEPS.map((step) => (
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
