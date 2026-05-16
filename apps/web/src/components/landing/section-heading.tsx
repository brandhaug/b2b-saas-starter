export function SectionHeading({
  badge,
  title,
  description
}: {
  readonly badge: string
  readonly title: string
  readonly description: string
}) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
        {badge}
      </span>
      <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
        {title}
      </h2>
      <p className="max-w-lg text-sm text-muted-foreground">{description}</p>
    </div>
  )
}
