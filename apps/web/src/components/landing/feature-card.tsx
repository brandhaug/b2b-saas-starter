import type { ReactNode } from 'react'

export function FeatureCard({
  title,
  description,
  children
}: {
  readonly title: string
  readonly description: string
  readonly children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  )
}
