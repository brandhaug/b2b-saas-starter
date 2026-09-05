import { Radio } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'

import { cn } from '@/lib/utils'

function RadioGroup<Value>({ className, ...props }: RadioGroupPrimitive.Props<Value>) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn('gap-2 grid', className)}
      {...props}
    />
  )
}

function RadioGroupItem<Value>({ className, ...props }: Radio.Root.Props<Value>) {
  return (
    <Radio.Root
      data-slot="radio-group-item"
      className={cn(
        'border-input bg-input/30 data-checked:bg-primary data-checked:text-primary-foreground data-checked:border-primary aria-invalid:border-destructive/50 focus-visible:border-ring aria-invalid:ring-destructive/40 flex size-4 items-center justify-center rounded-full border transition-colors group-has-disabled/field:opacity-50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:ring-1 peer relative shrink-0 outline-none after:absolute after:-inset-x-3 after:-inset-y-2 data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className
      )}
      {...props}
    >
      <Radio.Indicator
        data-slot="radio-group-item-indicator"
        className="bg-primary-foreground size-2 rounded-full block transition-none"
      />
    </Radio.Root>
  )
}

export { RadioGroup, RadioGroupItem }
