import { Checkbox } from '@/components/ui/checkbox'
import { FieldError, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'

/**
 * A TanStack Form field over a set of values drawn from a fixed vocabulary:
 * API token scopes, webhook event types. Every option is a checkbox, the
 * selection is an order-preserving subset, and the field's validation error
 * sits under the group.
 *
 * Presentation only — it takes the field's current value and hands back the
 * next one, so the form owns the state and the validator.
 */
export function CheckboxSetField<A extends string>({
  name,
  legend,
  options,
  value,
  errors,
  onChange
}: {
  readonly name: string
  readonly legend: string
  /** The whole vocabulary, in the order it is offered. */
  readonly options: ReadonlyArray<A>
  readonly value: ReadonlyArray<A>
  readonly errors: ReadonlyArray<unknown>
  readonly onChange: (next: ReadonlyArray<A>) => void
}) {
  const hasError = errors.length > 0
  const errorId = `${name}-error`
  const selected = new Set(value)

  return (
    <FieldSet data-invalid={hasError || undefined}>
      <FieldLegend variant="label">{legend}</FieldLegend>
      <div className="flex flex-wrap gap-3">
        {options.map((option) => (
          <FieldLabel key={option}>
            <Checkbox
              checked={selected.has(option)}
              onCheckedChange={(checked) => {
                onChange(
                  checked
                    ? [...new Set([...value, option])]
                    : value.filter((item) => item !== option)
                )
              }}
            />

            <span>{option}</span>
          </FieldLabel>
        ))}
      </div>
      {hasError ? <FieldError id={errorId}>{errors.join(', ')}</FieldError> : null}
    </FieldSet>
  )
}
