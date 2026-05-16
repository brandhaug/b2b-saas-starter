import type { ComponentProps } from 'react'
import { Input } from './ui/input'
import { Label } from './ui/label'

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
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
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
      {hasError ? (
        <p id={errorId} className="text-xs text-destructive">
          {errors.join(', ')}
        </p>
      ) : null}
    </div>
  )
}
