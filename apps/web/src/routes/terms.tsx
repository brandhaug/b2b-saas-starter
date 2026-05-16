import { createFileRoute } from '@tanstack/react-router'
import { PublicLayout } from '@/components/public-layout'

export const Route = createFileRoute('/terms')({
  component: TermsPage
})

function TermsPage() {
  return (
    <PublicLayout>
      <main id="main-content" className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold">Terms</h1>
        <div className="prose prose-neutral mt-6 max-w-none dark:prose-invert">
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
