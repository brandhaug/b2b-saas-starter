import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

/**
 * An irreversible action's two states: the idle button that arms it, then an
 * armed pair (confirm plus cancel). The armed state can be owned here or
 * lifted — panels that arm one row at a time pass `armed`/`onArm`/`onCancel`
 * keyed to the row.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  busy = false,
  variant = 'ghost',
  size = 'sm',
  cancelVariant = 'ghost',
  className,
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
  readonly armed?: boolean
  readonly onArm?: () => void
  readonly onCancel?: () => void
}) {
  const [armedHere, setArmedHere] = useState(false)
  const isArmed = armed ?? armedHere

  if (!isArmed) {
    return (
      <Button
        variant={variant}
        size={size}
        className={className}
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
      <Button
        variant="destructive"
        size={size}
        disabled={busy}
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
