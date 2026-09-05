import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion'
import { faqItems } from '@/lib/content'

export const Route = createFileRoute('/_knowledge/faq')({
  component: FaqPage,
  head: () => ({
    meta: [
      { title: pageTitle('FAQ') },
      {
        name: 'description',
        content:
          'Answers about billing, licensing, and adopting the B2B SaaS Starter for your product.'
      },
      { property: 'og:title', content: pageTitle('FAQ') },
      {
        property: 'og:description',
        content:
          'Answers about billing, licensing, and adopting the B2B SaaS Starter for your product.'
      }
    ]
  })
})

function FaqPage() {
  // The first answer starts open: a page of nothing but collapsed questions
  // reads as a bare list, and the first item is what almost every visitor
  // opened the page for.
  const [firstFaq] = faqItems
  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-3xl font-semibold">FAQ</h1>
      <Accordion
        className="mt-8"
        defaultValue={firstFaq === undefined ? [] : [firstFaq.question]}
      >
        {faqItems.map((item) => (
          <AccordionItem key={item.question} value={item.question}>
            <AccordionTrigger>{item.question}</AccordionTrigger>
            <AccordionContent>{item.answer}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}
