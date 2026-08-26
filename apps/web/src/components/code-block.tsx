import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CheckIcon, CopyIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export function CodeBlock({
  language,
  code,
  className
}: {
  readonly language: string
  readonly code: string
  readonly className?: string
}) {
  const [copied, setCopied] = useState(false)
  const resetTimerRef = useRef<number | undefined>(undefined)

  // Unmounting within the 2-second feedback window must not schedule a
  // post-unmount state update.
  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== undefined)
        {window.clearTimeout(resetTimerRef.current)}
    }
  }, [])

  function copy() {
    // Clipboard access can reject (permissions/insecure context); the code is
    // still selectable by hand, so a rejected write resolves to null.
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true)
        resetTimerRef.current = window.setTimeout(() => setCopied(false), 2000)
        return resetTimerRef.current
      })
      .catch(() => null)
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-border bg-card',
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          {language}
        </span>
        <Button
          variant="ghost"
          size="xs"
          onClick={copy}
          aria-label={copied ? 'Copied' : `Copy ${language} code`}
        >
          {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          <span aria-hidden="true">{copied ? 'Copied' : 'Copy'}</span>
        </Button>
      </div>
      {/* tabIndex makes the horizontally scrollable region keyboard-operable
          (WCAG 2.1.1); the label names it for screen readers. */}
      <pre
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable pre regions must be focusable to be keyboard-scrollable
        tabIndex={0}
        aria-label={`${language} code sample`}
        className="overflow-x-auto p-3 text-xs leading-relaxed text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        {/* oxlint-disable-next-line better-tailwindcss/no-concatenated-classes -- `language-*` is the syntax-highlighter's hook class, not a Tailwind utility, so Tailwind has nothing to purge */}
        <code className={`language-${language}`}>{code}</code>
      </pre>
    </div>
  )
}
