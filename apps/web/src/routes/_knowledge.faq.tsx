import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion'
import { faqItems } from '@/lib/content'
import { m } from '@b2b-saas-starter/i18n/messages'

export const Route = createFileRoute('/_knowledge/faq')({
  component: FaqPage,
  head: () => ({
    meta: [
      { title: pageTitle(m.public_faq_title()) },
      {
        name: 'description',
        content: m.public_faq_description()
      },
      { property: 'og:title', content: pageTitle(m.public_faq_title()) },
      {
        property: 'og:description',
        content: m.public_faq_description()
      }
    ]
  })
})

function FaqPage() {
  // The first answer starts open: a page of nothing but collapsed questions
  // reads as a bare list, and the first item is what almost every visitor
  // opened the page for.
  const items = faqItems()
  const [firstFaq] = items
  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-3xl font-semibold">{m.public_faq_title()}</h1>
      <Accordion
        className="mt-8"
        defaultValue={firstFaq === undefined ? [] : [firstFaq.question]}
      >
        {items.map((item) => (
          <AccordionItem key={item.question} value={item.question}>
            <AccordionTrigger>{item.question}</AccordionTrigger>
            <AccordionContent>{item.answer}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}
