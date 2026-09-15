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
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16">
        <div>
          <h2 className="font-display text-balance text-3xl font-medium leading-display sm:text-4xl">
            {m.public_faq_title()}
          </h2>
          <p className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground">
            {m.public_faq_description()}
          </p>
        </div>
        <Accordion defaultValue={firstFaq === undefined ? [] : [firstFaq.question]}>
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
