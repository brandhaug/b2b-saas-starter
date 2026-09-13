'use client'

import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { cn } from '@/lib/utils'

function Popover(props: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root {...props} />
}
function PopoverTrigger(props: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger {...props} />
}
function PopoverContent({
  className,
  children,
  ...props
}: PopoverPrimitive.Popup.Props) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner sideOffset={8} className="z-50">
        <PopoverPrimitive.Popup
          className={cn(
            'max-h-(--available-height) w-112 max-w-(--available-width) overflow-y-auto rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md outline-none',
            className
          )}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}
export { Popover, PopoverTrigger, PopoverContent }
