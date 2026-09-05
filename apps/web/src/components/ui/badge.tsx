import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'h-5.5 gap-1 rounded-md border border-transparent px-2 py-0.5 text-xs font-medium transition-colors has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:size-3! inline-flex items-center justify-center w-fit whitespace-nowrap shrink-0 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:ring-destructive/40 aria-invalid:border-destructive overflow-hidden group/badge',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a]:hover:bg-primary/80',
        destructive:
          'bg-destructive/20 [a]:hover:bg-destructive/20 focus-visible:ring-destructive text-destructive',
        outline:
          'border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground',
        /* Status vocabulary: one hue per state, from the --status-* tokens
           (see DESIGN.md and index.css). `default` (mauve) is the emphasis
           hue — current/selected, never a status; the one other emphasis use
           is the owner role, via `roleVariant` in lib/badge-variants.ts. */
        ok: 'bg-status-ok/10 text-status-ok [a]:hover:bg-status-ok/20',
        warn: 'bg-status-warn/10 text-status-warn [a]:hover:bg-status-warn/20',
        info: 'bg-status-info/10 text-status-info [a]:hover:bg-status-info/20',
        neutral: 'bg-secondary text-secondary-foreground'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

function Badge({
  className,
  variant = 'default',
  render,
  ...props
}: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        className: cn(badgeVariants({ className, variant }))
      },
      props
    ),
    render,
    state: {
      slot: 'badge',
      variant
    }
  })
}

export { Badge }
