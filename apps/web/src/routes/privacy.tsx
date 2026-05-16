import { createFileRoute } from '@tanstack/react-router'
import { PublicLayout } from '@/components/public-layout'

export const Route = createFileRoute('/privacy')({
  component: PrivacyPage
})

function PrivacyPage() {
  return (
    <PublicLayout>
      <main id="main-content" className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold">Privacy</h1>
        <div className="prose prose-neutral mt-6 max-w-none dark:prose-invert">
          <p>
            This starter-focused page describes the reference app's data categories:
            users, sessions, workspaces, members, module states, API tokens, audit
            events, notifications, reports, webhooks, and optional provider
            configuration.
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
