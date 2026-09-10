import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { PublicLayout } from '@/components/public-layout'
import { m } from '@b2b-saas-starter/i18n/messages'

export const Route = createFileRoute('/privacy')({
  component: PrivacyPage,
  head: () => ({
    meta: [
      { title: pageTitle(m.public_legal_privacy_title()) },
      {
        name: 'description',
        content: m.public_legal_privacy_description()
      },
      { property: 'og:title', content: pageTitle(m.public_legal_privacy_title()) },
      {
        property: 'og:description',
        content: m.public_legal_privacy_description()
      }
    ]
  })
})

function PrivacyPage() {
  return (
    <PublicLayout>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 outline-none"
      >
        <h1 className="text-3xl font-semibold">{m.public_legal_privacy_title()}</h1>
        <div className="prose prose-lg mt-6 max-w-none">
          <p>{m.public_legal_privacy_intro()}</p>

          <h2>{m.public_legal_privacy_collects_title()}</h2>
          <p>{m.public_legal_privacy_collects()}</p>

          <h2>{m.public_legal_privacy_stores_title()}</h2>
          <p>{m.public_legal_privacy_stores()}</p>

          <h2>{m.public_legal_privacy_local_title()}</h2>
          <p>{m.public_legal_privacy_local()}</p>

          <h2>{m.public_legal_privacy_ship_title()}</h2>
          <p>{m.public_legal_privacy_ship()}</p>
        </div>
      </main>
    </PublicLayout>
  )
}
