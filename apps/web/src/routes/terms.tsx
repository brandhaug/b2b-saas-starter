import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { PublicLayout } from '@/components/public-layout'

export const Route = createFileRoute('/terms')({
  component: TermsPage,
  head: () => ({
    meta: [
      { title: pageTitle('Terms') },
      {
        name: 'description',
        content:
          'Implementation-copy terms covering acceptable use, accounts, billing, and API access for the starter.'
      },
      { property: 'og:title', content: pageTitle('Terms') },
      {
        property: 'og:description',
        content:
          'Implementation-copy terms covering acceptable use, accounts, billing, and API access for the starter.'
      }
    ]
  })
})

function TermsPage() {
  return (
    <PublicLayout>
      <main id="main-content" className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold">Terms</h1>
        <div className="prose prose-lg mt-6 max-w-none">
          <p>
            These starter terms are implementation copy, not final legal terms. They
            show where teams describe acceptable use, accounts, billing, workspace data,
            optional providers, and API/MCP access.
          </p>
          <p>
            Replace this content before production use with terms reviewed for your
            product, jurisdiction, and customer commitments.
          </p>
        </div>
      </main>
    </PublicLayout>
  )
}
