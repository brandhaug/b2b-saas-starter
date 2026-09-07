import { cn } from '@/lib/utils'
import { Loader2Icon } from 'lucide-react'

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <span data-slot="spinner" className="inline-flex motion-safe:animate-spin">
      <Loader2Icon
        // Decorative inline: the action's label carries the state ("Signing
        // in…"), so an aria-label here only concatenated into button names.
        aria-hidden="true"
        className={cn('size-4', className)}
        {...props}
      />
    </span>
  )
}

export { Spinner }
