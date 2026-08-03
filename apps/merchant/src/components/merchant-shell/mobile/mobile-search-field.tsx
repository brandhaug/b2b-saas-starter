import { Search, X } from 'lucide-react'

export function MobileSearchField({
  id,
  label,
  placeholder,
  value,
  clearLabel,
  inputDataAttribute,
  onValueChange
}: {
  readonly id: string
  readonly label: string
  readonly placeholder: string
  readonly value: string
  readonly clearLabel: string
  readonly inputDataAttribute?: `data-${string}`
  readonly onValueChange: (value: string) => void
}) {
  const inputData = inputDataAttribute ? { [inputDataAttribute]: 'true' } : {}

  return (
    <div
      data-mobile-search-field="true"
      className="flex h-10 items-center gap-2 rounded-2xl bg-muted px-3 text-muted-foreground"
    >
      <Search aria-hidden className="size-[1.125rem] shrink-0" strokeWidth={2} />
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        {...inputData}
        id={id}
        type="search"
        inputMode="search"
        autoComplete="off"
        enterKeyHint="search"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className="min-w-0 flex-1 appearance-none bg-transparent text-base leading-6 font-medium text-foreground outline-none placeholder:text-muted-foreground/80 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
      />
      {value ? (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => onValueChange('')}
          className="grid size-6 shrink-0 place-items-center rounded-full bg-muted-foreground/15 active:scale-95"
        >
          <X aria-hidden className="size-3.5" strokeWidth={2.25} />
        </button>
      ) : null}
    </div>
  )
}
