import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

/**
 * An irreversible action's two states: the idle button that arms it, then an
 * armed pair (confirm plus cancel). The armed state can be owned here or
 * lifted — panels that arm one row at a time pass `armed`/`onArm`/`onCancel`
 * keyed to the row. Pass `target` to distinguish rows by accessible name.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  busy = false,
  variant = 'ghost',
  size,
  cancelVariant = 'ghost',
  className,
  target,
  armed,
  onArm,
  onCancel
}: {
  readonly label: string
  readonly confirmLabel: string
  readonly cancelLabel?: string
  readonly onConfirm: () => void
  readonly busy?: boolean
  readonly variant?: React.ComponentProps<typeof Button>['variant']
  readonly size?: React.ComponentProps<typeof Button>['size']
  readonly cancelVariant?: React.ComponentProps<typeof Button>['variant']
  readonly className?: string
  readonly target?: string
  readonly armed?: boolean
  readonly onArm?: () => void
  readonly onCancel?: () => void
}) {
  const [armedHere, setArmedHere] = useState(false)
  const isArmed = armed ?? armedHere

  const confirmRef = useRef<HTMLButtonElement>(null)
  const idleRef = useRef<HTMLButtonElement>(null)
  const onCancelRef = useRef(onCancel)
  // True once the button has been armed at least once; guards the effect so
  // the idle button never steals focus on first mount.
  const wasArmedRef = useRef(false)

  useEffect(() => {
    if (!isArmed) {
      // Disarm (Escape, Cancel, or Confirm): the armed pair unmounted, which
      // used to drop focus to <body> — restore it to the idle trigger.
      if (wasArmedRef.current) {
        wasArmedRef.current = false
        idleRef.current?.focus()
      }
      return
    }
    wasArmedRef.current = true
    onCancelRef.current = onCancel
    confirmRef.current?.focus()
    function disarm(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return
      }
      setArmedHere(false)
      onCancelRef.current?.()
    }
    document.addEventListener('keydown', disarm)
    return () => document.removeEventListener('keydown', disarm)
  }, [isArmed, onCancel])

  const row = target ? ` ${target}` : ''

  if (!isArmed) {
    return (
      <Button
        ref={idleRef}
        variant={variant}
        size={size}
        className={className}
        aria-label={`${label}${row}`}
        onClick={() => {
          setArmedHere(true)
          onArm?.()
        }}
      >
        {label}
      </Button>
    )
  }
  return (
    <>
      <span className="sr-only" role="alert">
        Press again to confirm{target ? ` ${target}` : ''}
      </span>
      <Button
        ref={confirmRef}
        variant="destructive"
        size={size}
        disabled={busy}
        aria-label={`${confirmLabel}${row}`}
        onClick={() => {
          setArmedHere(false)
          onCancel?.()
          onConfirm()
        }}
      >
        {busy ? <Spinner data-icon="inline-start" /> : null}
        {confirmLabel}
      </Button>
      <Button
        variant={cancelVariant}
        size={size}
        aria-label={`${cancelLabel}${row}`}
        onClick={() => {
          setArmedHere(false)
          onCancel?.()
        }}
      >
        {cancelLabel}
      </Button>
    </>
  )
}
