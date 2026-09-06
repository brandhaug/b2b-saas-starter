import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { PublicLayout } from '@/components/public-layout'
import { m } from '@b2b-saas-starter/i18n/messages'

export const Route = createFileRoute('/terms')({
  component: TermsPage,
  head: () => ({
    meta: [
      { title: pageTitle(m.public_legal_terms_title()) },
      {
        name: 'description',
        content: m.public_legal_terms_description()
      },
      { property: 'og:title', content: pageTitle(m.public_legal_terms_title()) },
      {
        property: 'og:description',
        content: m.public_legal_terms_description()
      }
    ]
  })
})

function TermsPage() {
  return (
    <PublicLayout>
      <main id="main-content" className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold">{m.public_legal_terms_title()}</h1>
        <div className="prose prose-lg mt-6 max-w-none">
          <p>{m.public_legal_terms_intro()}</p>
          <p>{m.public_legal_terms_replace()}</p>
        </div>
      </main>
    </PublicLayout>
  )
}
