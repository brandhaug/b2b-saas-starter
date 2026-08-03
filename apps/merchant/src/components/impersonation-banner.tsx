import { useEffect, useRef, useState } from 'react'
import type { ImpersonationLifecyclePresentation } from '@b2b-saas-starter/capabilities/operations'
import { remainingImpersonationSeconds } from './impersonation-banner-utils.ts'

const currentDate = () => new Date()

const countdown = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}

export function ImpersonationBanner({
  presentation,
  now = currentDate,
  onStop,
  onExpired
}: {
  readonly presentation: Omit<ImpersonationLifecyclePresentation, 'state'>
  readonly now?: () => Date
  readonly onStop: () => Promise<void>
  readonly onExpired: () => void
}) {
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    remainingImpersonationSeconds(presentation.expiresAt, now())
  )
  const [confirmingStop, setConfirmingStop] = useState(false)
  const [stopping, setStopping] = useState(false)
  const expiryRequested = useRef(false)

  useEffect(() => {
    const update = () => {
      const remaining = remainingImpersonationSeconds(presentation.expiresAt, now())
      setRemainingSeconds(remaining)
      if (remaining === 0 && !expiryRequested.current) {
        expiryRequested.current = true
        onExpired()
      }
    }
    const interval = window.setInterval(update, 1_000)
    return () => window.clearInterval(interval)
  }, [now, onExpired, presentation.expiresAt])

  return (
    <aside
      aria-label="Active staff impersonation"
      aria-live="polite"
      className="sticky top-0 z-50 border-b border-primary bg-accent px-4 py-3 text-accent-foreground"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Staff impersonation is active</p>
          <p className="text-sm">
            An operator is acting as <strong>{presentation.targetMemberName}</strong>{' '}
            for <strong>{presentation.merchantName}</strong>.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <time
            dateTime={presentation.expiresAt}
            className="font-mono text-sm font-semibold tabular-nums"
          >
            {countdown(remainingSeconds)} remaining
          </time>
          {confirmingStop ? (
            <fieldset className="flex items-center gap-2">
              <legend className="sr-only">Confirm stop</legend>
              <span className="text-sm font-medium">End staff access now?</span>
              <button
                className="h-9 rounded-md bg-secondary px-3 text-sm font-medium text-secondary-foreground"
                disabled={stopping}
                type="button"
                onClick={() => setConfirmingStop(false)}
              >
                Keep impersonating
              </button>
              <button
                className="h-9 rounded-md bg-destructive px-3 text-sm font-medium text-destructive-foreground disabled:opacity-60"
                disabled={stopping}
                type="button"
                onClick={() => {
                  setStopping(true)
                  void onStop().catch(() => setStopping(false))
                }}
              >
                {stopping ? 'Stopping…' : 'Confirm stop'}
              </button>
            </fieldset>
          ) : (
            <button
              className="h-9 rounded-md bg-secondary px-3 text-sm font-medium text-secondary-foreground"
              disabled={remainingSeconds === 0}
              type="button"
              onClick={() => setConfirmingStop(true)}
            >
              Stop impersonation
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
