import { createFileRoute } from '@tanstack/react-router'
import { PublicLayout } from '@/components/public-layout'
import { GITHUB_URL } from '@/components/landing/github-url'

export const Route = createFileRoute('/changelog')({
  component: ChangelogPage,
  head: () => ({
    meta: [
      { title: 'Changelog | B2B SaaS Starter' },
      {
        name: 'description',
        content:
          'Release history for the B2B SaaS Starter: new capabilities, fixes, and breaking changes by version.'
      },
      { property: 'og:title', content: 'Changelog | B2B SaaS Starter' },
      {
        property: 'og:description',
        content:
          'Release history for the B2B SaaS Starter: new capabilities, fixes, and breaking changes by version.'
      }
    ]
  })
})

/**
 * Releases are cut by release-please from Conventional Commits, so the notes
 * live where the tags live: GitHub Releases. This page links there rather
 * than hand-maintaining a second copy that would drift the moment a version
 * ships.
 */
function ChangelogPage() {
  return (
    <PublicLayout>
      <main id="main-content" className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="font-display text-3xl font-semibold">Changelog</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Every release is tagged and published from Conventional Commits by
          release-please. Versioned notes, assets, and breaking changes live on GitHub
          Releases:
        </p>
        <p className="mt-4">
          <a
            href={`${GITHUB_URL}/releases`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-4"
          >
            github.com/brandhaug/b2b-saas-starter/releases
            <span className="sr-only">(opens in new tab)</span>
          </a>
        </p>
      </main>
    </PublicLayout>
  )
}
