import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion'
import { faqItems } from '@/lib/content'
import { m } from '@b2b-saas-starter/i18n/messages'

function FaqSection() {
  const items = faqItems()
  const [firstFaq] = items

  return (
    <section id="faq" className="border-t border-border">
      <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
        <h2 className="font-display text-balance text-3xl font-semibold sm:text-4xl">
          {m.public_faq_title()}
        </h2>
        <p className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground">
          {m.public_faq_description()}
        </p>
        <Accordion
          className="mt-8"
          defaultValue={firstFaq === undefined ? [] : [firstFaq.question]}
        >
          {items.map((item) => (
            <AccordionItem key={item.question} value={item.question}>
              {/* A question sits under this section's own h2, never beside it. */}
              <AccordionTrigger headingLevel="h3">{item.question}</AccordionTrigger>
              <AccordionContent>{item.answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}

export { FaqSection }
