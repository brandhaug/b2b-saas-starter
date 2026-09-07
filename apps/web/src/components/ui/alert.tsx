import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { CircleAlertIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-none border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        /* Tinted fill + tinted border, never plain card: inside a Panel (also
           bg-card/border-border) a failed mutation must read as an alert, not
           as one more row. The icon is mandatory — see the fallback in
           `Alert`. The title rides the description's foreground because the
           destructive ink on the tinted fill misses 4.5:1 on a muted page;
           the icon keeps the tint (non-text contrast). */
        destructive:
          'bg-destructive/5 border-destructive/40 text-destructive *:data-[slot=alert-description]:text-foreground *:data-[slot=alert-title]:text-foreground *:[svg]:text-current',
        /* Success state, from the same status token as the ok badge. */
        ok: 'bg-status-ok/10 border-status-ok/40 text-status-ok *:data-[slot=alert-description]:text-foreground *:[svg]:text-current'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

function Alert({
  className,
  variant,
  children,
  icon = variant === 'destructive' ? <CircleAlertIcon aria-hidden="true" /> : null,
  ...props
}: React.ComponentProps<'div'> &
  VariantProps<typeof alertVariants> & {
    readonly icon?: React.ReactNode
  }) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {icon}
      {children}
    </div>
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        'font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground',
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'text-sm/relaxed text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-2',
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-action"
      className={cn(
        'absolute top-[calc(--spacing(1.25))] right-[calc(--spacing(1.25))]',
        className
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
