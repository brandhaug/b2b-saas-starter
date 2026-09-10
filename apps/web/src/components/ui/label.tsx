'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

function Label({ className, ...props }: React.ComponentProps<'label'>) {
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
        className
      )}
      {...props}
    />
  )
}

export { Label }
