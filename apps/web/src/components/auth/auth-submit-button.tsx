import { type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

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
 * submit, with a submitting label while it is in flight.
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
        <Button type="submit" disabled={!canSubmit}>
          {icon}
          {isSubmitting ? submittingLabel : label}
        </Button>
      )}
    </form.Subscribe>
  )
}
