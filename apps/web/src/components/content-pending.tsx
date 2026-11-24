import { Skeleton } from '@/components/ui/skeleton'

/**
 * Placeholder for content that loads inside an already rendered page: a few
 * plain bars, never a replica of the content. `label` is announced to screen
 * readers only; the bars are decorative.
 */
export function ContentPending({
  label,
  lines = 3
}: {
  readonly label: string
  readonly lines?: number
}) {
  return (
    <output className="grid w-full gap-3" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={index === lines - 1 ? 'h-4 w-2/3' : 'h-4 w-full'}
        />
      ))}
    </output>
  )
}
