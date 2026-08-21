function SnippetPanel({
  label,
  code
}: {
  readonly label: string
  readonly code: string
}) {
  return (
    <figure className="min-w-0 border border-border bg-card">
      <figcaption className="border-b border-border px-4 py-2 font-mono text-xs text-muted-foreground">
        {label}
      </figcaption>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-foreground/90">
        <code>{code}</code>
      </pre>
    </figure>
  )
}

export { SnippetPanel }
