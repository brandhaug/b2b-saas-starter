import { Accordion as AccordionPrimitive } from '@base-ui/react/accordion'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

function Accordion({ className, ...props }: AccordionPrimitive.Root.Props) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn('flex w-full flex-col', className)}
      {...props}
    />
  )
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn('not-last:border-b', className)}
      {...props}
    />
  )
}

function AccordionTrigger({
  className,
  children,
  headingLevel: Heading = 'h3',
  ...props
}: AccordionPrimitive.Trigger.Props & {
  /**
   * The tag the header renders. Each trigger is a heading in the document
   * outline, so it belongs one level under whatever heading introduces the
   * accordion — `h3` under a section's `h2`, the common case.
   */
  headingLevel?: 'h2' | 'h3' | 'h4'
}) {
  return (
    // The heading renders empty here; its text is the trigger's children,
    // which base-ui nests inside it.
    <AccordionPrimitive.Header className="flex" render={<Heading />}>
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          'focus-visible:border-ring focus-visible:after:border-ring **:data-[slot=accordion-trigger-icon]:text-muted-foreground rounded-none py-2.5 text-left text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 group/accordion-trigger relative flex flex-1 items-start justify-between border border-transparent transition-colors outline-none disabled:pointer-events-none disabled:opacity-50',
          className
        )}
        {...props}
      >
        {children}
        <span className="relative size-4 shrink-0" aria-hidden="true">
          <ChevronDownIcon
            data-slot="accordion-trigger-icon"
            className="icon-transition pointer-events-none absolute inset-0 group-aria-expanded/accordion-trigger:scale-25 group-aria-expanded/accordion-trigger:opacity-0 group-aria-expanded/accordion-trigger:blur-[4px]"
          />
          <ChevronUpIcon
            data-slot="accordion-trigger-icon"
            className="icon-transition pointer-events-none absolute inset-0 scale-25 opacity-0 blur-[4px] group-aria-expanded/accordion-trigger:scale-100 group-aria-expanded/accordion-trigger:opacity-100 group-aria-expanded/accordion-trigger:blur-none"
          />
        </span>
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({
  className,
  children,
  ...props
}: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      // The height animation is `motion-safe:`-gated like every other
      // primitive here; without it the panel simply appears.
      className="text-sm overflow-hidden motion-safe:h-(--accordion-panel-height) motion-safe:transition-[height] motion-safe:duration-200 motion-safe:ease-out motion-safe:data-starting-style:h-0 motion-safe:data-ending-style:h-0"
      {...props}
    >
      <div
        className={cn(
          'pt-0 pb-2.5 [&_a]:hover:text-foreground h-(--accordion-panel-height) [&_a]:underline [&_a]:underline-offset-3 [&_p:not(:last-child)]:mb-4',
          className
        )}
      >
        {children}
      </div>
    </AccordionPrimitive.Panel>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
