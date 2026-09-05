import { createFileRoute, redirect } from '@tanstack/react-router'
import { GITHUB_URL } from '@/components/landing/github-url'

/**
 * The starter has no tagged releases yet. Releases are cut by release-please
 * from Conventional Commits, so when they exist they will live where the tags
 * live: GitHub Releases. This page refuses to fabricate a changelog no
 * release ever produced — it points at the repository's releases (and its
 * commits, until the first one ships) the same way routes/pricing.tsx points
 * at the real plan vocabulary instead of hosting a copy that would drift.
 * When a root CHANGELOG.md appears from the first release, this route can
 * go back to rendering it via a `?raw` import.
 */
export const Route = createFileRoute('/_knowledge/changelog')({
  beforeLoad: () => {
    throw redirect({ href: `${GITHUB_URL}/releases`, replace: true })
  }
})
