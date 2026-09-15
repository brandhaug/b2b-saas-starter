import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_knowledge/docs/')({
  beforeLoad: () => {
    throw redirect({
      to: '/docs/$category/$slug',
      params: { category: 'getting-started', slug: 'quickstart' },
      replace: true
    })
  }
})
