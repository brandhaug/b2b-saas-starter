import { createFileRoute } from '@tanstack/react-router'
import { PublicLayout } from '@/components/public-layout'

export const Route = createFileRoute('/help/')({
  component: HelpPage
})

function HelpPage() {
  return (
    <PublicLayout>
      <main id="main-content" className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold">Help</h1>
        <p className="mt-4 text-muted-foreground">
          Help content explains how to run the starter locally, configure optional
          providers, understand module readiness, and operate the reference workspace.
        </p>
      </main>
    </PublicLayout>
  )
}
