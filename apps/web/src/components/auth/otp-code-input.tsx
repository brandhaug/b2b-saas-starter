import { useRef } from 'react'
import { Input } from '@/components/ui/input'
import { m } from '@b2b-saas-starter/i18n/messages'

/** The code length the email-otp plugin is configured with. */
const CODE_LENGTH = 6

/**
 * The six-cell one-time-code input. One logical value (`value`, a string of at
 * most `OTP_CODE_LENGTH` digits); the cells are its presentation.
 *
 * Each cell edits its corresponding digit. A paste or browser one-time-code
 * autofill still fills the complete value, while Backspace removes the focused
 * digit and moves to the preceding cell. The value stays left-packed, so the
 * verify button's enabled state and the plugin's own check always see the code
 * the user believes they typed. Arrow keys move focus between cells for visual
 * review only.
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
      // The cell was cleared (select + delete): remove its digit and compact
      // the suffix into the now-empty cell.
      onChange(value.slice(0, index) + value.slice(index + 1))
      focusCell(Math.min(index, value.length - 1))
      return
    }
    // A one-time-code autofill arrives as a multi-character change on the
    // first cell. Pasting into a later cell replaces the suffix from there.
    let next: string
    if (digits.length === 1) {
      next = value.slice(0, index) + digits + value.slice(index + 1)
    } else if (index === 0) {
      next = digits
    } else {
      next = value.slice(0, index) + digits
    }
    const clipped = next.slice(0, CODE_LENGTH)
    onChange(clipped)
    focusCell(
      digits.length === 1 ? index + 1 : Math.min(index + digits.length, CODE_LENGTH - 1)
    )
  }

  function handleKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace') {
      event.preventDefault()
      const targetIndex = index < value.length ? index : value.length - 1
      if (targetIndex < 0) {
        return
      }
      // Remove the focused digit when filled; on an empty cell, remove the
      // preceding digit as native inputs do. The remaining suffix shifts left.
      onChange(value.slice(0, targetIndex) + value.slice(targetIndex + 1))
      focusCell(index < value.length ? targetIndex - 1 : targetIndex)
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
            aria-label={m.public_auth_otp_digit({
              index: index + 1,
              length: CODE_LENGTH
            })}
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
