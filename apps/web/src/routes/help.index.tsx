import { createFileRoute } from '@tanstack/react-router'
import { PublicLayout } from '@/components/public-layout'

export const Route = createFileRoute('/help/')({
  component: HelpPage,
  head: () => ({
    meta: [
      { title: 'Help | B2B SaaS Starter' },
      {
        name: 'description',
        content:
          'How to run the starter locally, configure optional providers, and operate the reference workspace.'
      }
    ]
  })
})

function HelpPage() {
  return (
    <PublicLayout>
      <main id="main-content" className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold">Help</h1>
        <p className="mt-4 text-muted-foreground">
          Help content explains how to run the starter locally, configure optional
          providers, and operate the reference workspace.
        </p>
      </main>
    </PublicLayout>
  )
}
