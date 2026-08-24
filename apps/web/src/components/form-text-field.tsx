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
      {hasError ? <FieldError id={errorId}>{errors.join(', ')}</FieldError> : null}
    </Field>
  )
}
