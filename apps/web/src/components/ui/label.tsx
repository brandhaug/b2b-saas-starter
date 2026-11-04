'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

function Label({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'label'> & {
  variant?: 'default' | 'option' | 'choice' | 'hint'
}) {
  return (
    <label
      data-slot="label"
      className={cn(
        'gap-2 text-sm font-medium leading-none group-data-[disabled=true]:opacity-50 peer-disabled:opacity-50 flex items-center select-none group-data-[disabled=true]:pointer-events-none peer-disabled:cursor-not-allowed',
        // A label that wraps its own checkbox, radio or switch is the row the
        // finger aims at, so below `md` it carries the 44px touch height
        // (DESIGN.md), same rule FieldLabel applies. Gated on containing a
        // control: a plain label above an input stays text-height.
        'max-md:[&:has([data-slot=checkbox],[data-slot=radio-group-item],[data-slot=switch])]:min-h-11 max-md:[&:has([data-slot=checkbox],[data-slot=radio-group-item],[data-slot=switch])]:items-center',
        variant === 'option' &&
          'focus-within:ring-ring h-8 w-full cursor-pointer rounded-sm px-2 text-sm hover:bg-muted/50 focus-within:ring-2 max-md:h-11',
        variant === 'choice' &&
          'items-start gap-3 rounded-sm border border-border px-3 py-2 has-data-checked:border-primary',
        variant === 'hint' && 'text-xs font-normal text-muted-foreground',
        className
      )}
      {...props}
    />
  )
}

export { Label }
