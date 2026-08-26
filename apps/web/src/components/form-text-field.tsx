import { type ComponentProps } from 'react'
import { Field, FieldError, FieldLabel } from './ui/field'
import { Input } from './ui/input'

type FormTextFieldProps = Omit<
  ComponentProps<typeof Input>,
  'id' | 'name' | 'value' | 'onBlur' | 'onChange' | 'aria-invalid' | 'aria-describedby'
> & {
  readonly name: string
  readonly label: string
  readonly value: string
  readonly errors: readonly unknown[]
  readonly onBlur: () => void
  readonly onChange: (value: string) => void
}

// oxlint-disable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, starter/no-unknown-error-message
// TanStack Form validator failures reach this component untyped — a plain
// string from our validators, or an object carrying a `message`. This is the
// parse step for that boundary: the shape probes live here once and nowhere else.
function errorMessageOf(error: unknown): string | undefined {
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error
    if (typeof message === 'string') return message
  }
  return undefined
}
// oxlint-enable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, starter/no-unknown-error-message

export function FormTextField({
  name,
  label,
  value,
  errors,
  onBlur,
  onChange,
  ...inputProps
}: FormTextFieldProps) {
  const hasError = errors.length > 0
  const errorId = `${name}-error`
  const errorMessages = errors
    .map(errorMessageOf)
    .filter((message): message is string => message !== undefined)

  return (
    <Field data-invalid={hasError || undefined}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <Input
        id={name}
        name={name}
        value={value}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={hasError}
        aria-describedby={hasError ? errorId : undefined}
        {...inputProps}
      />
      {hasError && errorMessages.length > 0 ? (
        <FieldError id={errorId}>{errorMessages.join(', ')}</FieldError>
      ) : null}
    </Field>
  )
}
