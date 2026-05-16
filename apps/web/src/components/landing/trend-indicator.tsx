import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'

export function TrendIndicator({
  trend
}: {
  readonly trend: 'up' | 'stable' | 'down'
}) {
  if (trend === 'up') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
        <ArrowUpRight size={14} aria-hidden="true" />
        Rising
      </span>
    )
  }
  if (trend === 'down') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <ArrowDownRight size={14} aria-hidden="true" />
        Declining
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Minus size={14} aria-hidden="true" />
      Stable
    </span>
  )
}
