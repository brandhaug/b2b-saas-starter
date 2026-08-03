export function ServiceField({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { readonly label: string }) {
  return (
    <label className="grid gap-1.5 text-sm">
      {label}
      <input
        className="h-10 rounded-xl border bg-card px-3 md:h-9 md:rounded-md"
        {...props}
      />
    </label>
  )
}

export function ServiceSelectField({
  label,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { readonly label: string }) {
  return (
    <label className="grid gap-1.5 text-sm">
      {label}
      <select
        className="h-10 rounded-xl border bg-card px-3 md:h-9 md:rounded-md"
        {...props}
      >
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>
    </label>
  )
}
