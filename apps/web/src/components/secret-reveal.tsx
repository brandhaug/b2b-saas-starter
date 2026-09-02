import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function maskSecret(secret: string) {
  if (secret.length <= 8) {
    return `••••••••${secret.slice(-4)}`
  }
  return `${secret.slice(0, 3)}…${secret.slice(-4)}`
}
export function SecretReveal({
  secret,
  label,
  className
}: {
  readonly secret: string
  readonly label: string
  readonly className?: string
}) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    await navigator.clipboard.writeText(secret)
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    // `flex-wrap` plus `min-w-0 break-all` on the code: a 40–64 character
    // token must wrap inside a 343px column instead of forcing the row (and
    // the Show/Copy buttons) off-screen on a phone.
    <span className={cn('flex flex-wrap items-center gap-2', className)}>
      <code className="min-w-0 max-w-full rounded-md bg-muted px-2 py-1 font-mono text-xs break-all">
        {revealed ? secret : maskSecret(secret)}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0"
        aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
        aria-pressed={revealed}
        onClick={() => {
          setRevealed((r) => !r)
        }}
      >
        {revealed ? 'Hide' : 'Show'}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0"
        onClick={() => void copy()}
      >
        Copy
        <span className="sr-only"> {label}</span>
      </Button>
      <output className="sr-only">{copied ? 'Copied' : ''}</output>
    </span>
  )
}
