import { cn } from '@/lib/utils'
import { Loader2Icon } from 'lucide-react'

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <Loader2Icon
      data-slot="spinner"
      // Decorative inline: the action's label carries the state ("Signing
      // in…"), so an aria-label here only concatenated into button names.
      aria-hidden="true"
      className={cn('size-4 motion-safe:animate-spin', className)}
      {...props}
    />
  )
}

export { Spinner }
