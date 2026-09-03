import { useRef } from 'react'
import { Input } from '@/components/ui/input'

/** The code length the email-otp plugin is configured with. */
const CODE_LENGTH = 6

/**
 * The six-cell one-time-code input. One logical value (`value`, a string of at
 * most `OTP_CODE_LENGTH` digits); the cells are its presentation.
 *
 * Editing is append/consume at the logical end, not per-cell splicing: typing
 * a digit fills the first empty cell, Backspace clears the last filled one,
 * and a paste fills from the start and keeps the leading digits. That keeps
 * the value left-packed (no holes), so the verify button's enabled state and
 * the plugin's own check always see the code the user believes they typed.
 * Arrow keys move focus between cells for visual review only.
 */
export function OtpCodeInput({
  value,
  onChange,
  disabled,
  autoFocus
}: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly disabled?: boolean | undefined
  readonly autoFocus?: boolean | undefined
}) {
  const cells = useRef<Array<HTMLInputElement | null>>([])

  function focusCell(index: number) {
    cells.current[Math.max(0, Math.min(index, CODE_LENGTH - 1))]?.focus()
  }

  function handleChange(index: number, raw: string) {
    const digits = raw.replaceAll(/\D/g, '')
    if (digits === '') {
      // The cell was cleared (select + delete): drop its digit.
      onChange(value.slice(0, index))
      focusCell(index - 1)
      return
    }
    // Typing one digit appends; a multi-character paste fills from the start.
    const next = digits.length === 1 ? `${value}${digits}` : digits
    const clipped = next.slice(0, CODE_LENGTH)
    onChange(clipped)
    focusCell(clipped.length)
  }

  function handleKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace') {
      event.preventDefault()
      // Consume the last filled digit — the cell layout stays left-packed.
      onChange(value.slice(0, -1))
      focusCell(value.length - 1)
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusCell(index - 1)
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusCell(index + 1)
    }
  }

  return (
    <div className="flex gap-2">
      {Array.from({ length: CODE_LENGTH }, (_, index) => {
        const digit = value[index] ?? ''
        return (
          <Input
            key={index}
            ref={(node) => {
              cells.current[index] = node
            }}
            className="h-9 w-10 px-0 text-center font-mono text-lg"
            type="text"
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            // iOS Safari zooms any focused input below 16px; the cells stay
            // at text-base (the md:text-sm shrink below is dropped for them).
            aria-label={`Digit ${index + 1} of ${CODE_LENGTH}`}
            maxLength={CODE_LENGTH}
            disabled={disabled}
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- the code step has exactly one field group, so focusing its first cell cannot surprise anyone mid-task
            autoFocus={autoFocus && index === 0}
            value={digit}
            onChange={(event) => handleChange(index, event.target.value)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onFocus={(event) => event.target.select()}
          />
        )
      })}
    </div>
  )
}
