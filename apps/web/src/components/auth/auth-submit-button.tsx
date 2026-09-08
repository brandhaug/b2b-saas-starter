import { type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

/**
 * The only part of the form API the submit button reads. Structural so it
 * accepts any `useForm` result regardless of its value/validator generics
 * (`AnyFormApi` does not expose `Subscribe`).
 */
type SubscribableForm = {
  readonly Subscribe: (props: {
    readonly selector: (state: {
      readonly canSubmit: boolean
      readonly isSubmitting: boolean
    }) => readonly [boolean, boolean]
    readonly children: (state: readonly [boolean, boolean]) => ReactNode
  }) => ReactNode | Promise<ReactNode>
}

/**
 * The submit button every auth form renders: disabled until the form can
 * submit, with a decorative Spinner while it is in flight. The label never
 * swaps — a stable accessible name is what a screen-reader user pressed — and
 * a separate live status region announces the progress.
 */
export function AuthSubmitButton({
  form,
  icon,
  label,
  submittingLabel
}: {
  readonly form: SubscribableForm
  readonly icon?: ReactNode
  readonly label: string
  /** Announced to assistive tech while submitting; never swaps the visible label. */
  readonly submittingLabel: string
}) {
  return (
    <form.Subscribe
      selector={(state): readonly [boolean, boolean] => [
        state.canSubmit,
        state.isSubmitting
      ]}
    >
      {([canSubmit, isSubmitting]) => (
        <>
          <Button
            type="submit"
            disabled={!canSubmit || isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? <Spinner data-icon="inline-start" /> : icon}
            {label}
          </Button>
          <output aria-live="polite" aria-atomic="true" className="sr-only">
            {isSubmitting ? submittingLabel : null}
          </output>
        </>
      )}
    </form.Subscribe>
  )
}
