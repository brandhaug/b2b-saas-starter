import { createFileRoute } from '@tanstack/react-router'
import { PublicLayout } from '@/components/public-layout'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion'
import { faqItems } from '@/lib/content'

export const Route = createFileRoute('/faq')({
  component: FaqPage
})

function FaqPage() {
  return (
    <PublicLayout>
      <main id="main-content" className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold">FAQ</h1>
        <Accordion className="mt-8">
          {faqItems.map((item) => (
            <AccordionItem key={item.question} value={item.question}>
              <AccordionTrigger>{item.question}</AccordionTrigger>
              <AccordionContent>{item.answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </main>
    </PublicLayout>
  )
}
