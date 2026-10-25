import { createFileRoute } from '@tanstack/react-router'
import { DocsSearch } from '@/components/docs-search'
import { pickOptionalStrings } from '@/lib/utils'

export const Route = createFileRoute('/_knowledge/docs/search')({
  validateSearch: (search) => ({
    q: (pickOptionalStrings(search, ['q']).q ?? '').slice(0, 200)
  }),
  component: DocsSearchPage
})

function DocsSearchPage() {
  const { q } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <DocsSearch
      query={q}
      onSearch={(query) => {
        void navigate({ search: { q: query } })
      }}
    />
  )
}
