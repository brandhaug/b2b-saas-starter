import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Help is the quickstart: the starter's "how do I run and configure this" is
 * maintained as real documentation, not a placeholder paragraph. Old links
 * land on the Getting started guide.
 */
export const Route = createFileRoute('/help/')({
  beforeLoad: () => {
    throw redirect({
      to: '/docs/$category/$slug',
      params: { category: 'getting-started', slug: 'quickstart' },
      replace: true
    })
  }
})
