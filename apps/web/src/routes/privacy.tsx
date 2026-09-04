import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { PublicLayout } from '@/components/public-layout'

export const Route = createFileRoute('/privacy')({
  component: PrivacyPage,
  head: () => ({
    meta: [
      { title: pageTitle('Privacy') },
      {
        name: 'description',
        content:
          'How the reference app categorizes workspace, member, session, and audit data.'
      },
      { property: 'og:title', content: pageTitle('Privacy') },
      {
        property: 'og:description',
        content:
          'How the reference app categorizes workspace, member, session, and audit data.'
      }
    ]
  })
})

function PrivacyPage() {
  return (
    <PublicLayout>
      <main id="main-content" className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="font-display text-3xl font-semibold">Privacy</h1>
        <div className="prose prose-lg mt-6 max-w-none">
          <p>
            This starter-focused page describes the reference app's data categories:
            users, sessions, workspaces, members, API tokens, audit events,
            notifications, reports, webhooks, and optional provider configuration.
          </p>
          <p>
            Teams using this starter must adapt this page for their actual legal entity,
            providers, retention policy, and compliance obligations.
          </p>
        </div>
      </main>
    </PublicLayout>
  )
}
