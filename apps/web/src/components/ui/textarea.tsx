import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // `text-base` at mobile sizes keeps iOS Safari from zooming on focus;
        // `min-h` instead of a fixed `h` so a `rows` attribute (or content)
        // can size the element taller than one line.
        'bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/40 aria-invalid:border-destructive/50 disabled:bg-input/80 min-h-16 rounded-md border px-3 py-2 text-base transition-colors focus-visible:ring-1 aria-invalid:ring-1 md:text-sm placeholder:text-muted-foreground w-full min-w-0 outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
