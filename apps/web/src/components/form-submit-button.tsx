import { type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

/**
 * The only part of the form API this button reads. Structural so it accepts
 * any `useForm` result regardless of its value/validator generics
 * (`AnyFormApi` does not expose `Subscribe`) — the same shape
 * `components/auth/auth-submit-button.tsx` subscribes to on the auth screens.
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
 * The submit button the workspace forms render: disabled until the form can
 * submit, with a decorative Spinner while the submission is in flight. The
 * label never swaps, so a screen-reader user keeps the accessible name they
 * pressed.
 */
export function FormSubmitButton({
  form,
  label
}: {
  readonly form: SubscribableForm
  readonly label: string
}) {
  return (
    <form.Subscribe
      selector={(state): readonly [boolean, boolean] => [
        state.canSubmit,
        state.isSubmitting
      ]}
    >
      {([canSubmit, isSubmitting]) => (
        <Button
          type="submit"
          disabled={!canSubmit || isSubmitting}
          aria-busy={isSubmitting}
          className="justify-self-start"
        >
          {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
          {label}
        </Button>
      )}
    </form.Subscribe>
  )
}
