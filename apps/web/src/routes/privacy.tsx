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
          'What this starter collects (nothing by default) and what a deployment of it stores in its own D1 database. Starter copy; replace it before production.'
      },
      { property: 'og:title', content: pageTitle('Privacy') },
      {
        property: 'og:description',
        content:
          'What this starter collects (nothing by default) and what a deployment of it stores in its own D1 database. Starter copy; replace it before production.'
      }
    ]
  })
})

function PrivacyPage() {
  return (
    <PublicLayout>
      <main id="main-content" className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold">Privacy</h1>
        <div className="prose prose-lg mt-6 max-w-none">
          <p>
            This is a template, and this page is starter copy: true for what the
            repository does out of the box, and short on purpose. It is not a policy
            written for any real company, because there is no company behind this
            starter.
          </p>

          <h2>What the public site collects</h2>
          <p>
            Nothing. The marketing and knowledge pages set no analytics cookies, load no
            third-party trackers, and talk to no ad tech. The optional providers the
            starter can wire up (Sentry, PostHog, Turnstile) ship disabled and stay
            inactive until a deployment configures them.
          </p>

          <h2>What a deployment stores</h2>
          <p>
            If you create an account on an instance built from this starter, it keeps
            what you give it: your email address, hashed credentials, sessions, the
            workspaces and members you set up, and the audit events those actions
            produce. All of it lives in that deployment&apos;s own Cloudflare D1
            database. There is no vendor behind the template receiving any of it.
          </p>

          <h2>Local development</h2>
          <p>
            The demo seed, its sample users and the starter-lab workspace included, runs
            entirely inside your own environment: in memory, or in your local D1 if you
            have one. Nothing it creates leaves your machine.
          </p>

          <h2>Before you ship</h2>
          <p>
            A real product needs a real policy: your legal entity, the providers you
            actually enable, retention windows, and the jurisdictions you operate in.
            Replace this page before your first real user arrives.
          </p>
        </div>
      </main>
    </PublicLayout>
  )
}
