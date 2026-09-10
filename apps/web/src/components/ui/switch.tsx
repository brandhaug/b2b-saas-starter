import { Switch as SwitchPrimitive } from '@base-ui/react/switch'

import { cn } from '@/lib/utils'

function Switch({
  className,
  size = 'default',
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: 'sm' | 'default'
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      // The `after:` box is the hit area, not the track: below `md` each size
      // gets the bleed that lands it on the 44px touch minimum (DESIGN.md) —
      // 12.8px around the 18.4px default track, 15px around the 14px small
      // one. Pointer widths keep the tighter 8px.
      className={cn(
        'data-checked:bg-primary focus-visible:border-ring aria-invalid:ring-destructive/40 aria-invalid:border-destructive/50 data-unchecked:bg-input/80 shrink-0 rounded-full border border-transparent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:ring-1 data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] peer group/switch relative inline-flex items-center transition-colors outline-none after:absolute after:-inset-x-3 after:-inset-y-2 max-md:data-[size=default]:after:-inset-y-[12.8px] max-md:data-[size=sm]:after:-inset-y-[15px] data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="bg-foreground data-checked:bg-primary-foreground rounded-full group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0 pointer-events-none block ring-0 transition-transform"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
