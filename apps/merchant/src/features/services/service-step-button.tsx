export function ServiceStepButton({
  active,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { readonly active: boolean }) {
  return (
    <button
      type="button"
      className={`h-9 rounded-xl text-sm font-medium md:rounded-md ${active ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
      {...props}
    />
  )
}
