import { type ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/**
 * The track of a segmented choice. Each option is a `Button` with the
 * `segment` variant and `aria-pressed`; the track owns the shared edge so the
 * options read as one control. Name it with a `legend` or `aria-label`.
 */
function SegmentGroup({ className, ...props }: ComponentProps<'fieldset'>) {
  return (
    <fieldset
      data-slot="segment-group"
      className={cn(
        'inline-flex w-fit rounded-md border border-input bg-input/30 p-0.5',
        className
      )}
      {...props}
    />
  )
}

export { SegmentGroup }
