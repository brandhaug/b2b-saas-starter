import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { m } from '@b2b-saas-starter/i18n/messages'
import articles from 'virtual:docs-search'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { searchDocs } from '@/lib/docs-search'

export function DocsSearch({
  query,
  onSearch
}: {
  readonly query: string
  readonly onSearch: (query: string) => void
}) {
  const [input, setInput] = useState({ query, draft: query })
  if (input.query !== query) {
    setInput({ query, draft: query })
  }
  const results = searchDocs(articles, query)
  let status = m.docs_search_count({ count: results.length })
  if (query.trim() === '') {
    status = m.docs_search_hint()
  } else if (results.length === 0) {
    status = m.docs_search_no_results()
  }
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{m.docs_search_title()}</h1>
        <p className="text-sm text-muted-foreground">{m.docs_search_language()}</p>
      </div>
      <search>
        <form
          className="flex items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            onSearch(input.draft.trim())
          }}
        >
          <Field className="min-w-0 flex-1">
            <FieldLabel htmlFor="docs-search-query">{m.docs_search_label()}</FieldLabel>
            <Input
              id="docs-search-query"
              type="search"
              maxLength={200}
              value={input.draft}
              onChange={(event) => setInput({ query, draft: event.target.value })}
            />
          </Field>
          <Button type="submit" variant="outline">
            {m.common_search()}
          </Button>
        </form>
      </search>
      <output className="text-sm text-muted-foreground">{status}</output>
      {results.length > 0 ? (
        <ul
          aria-label={m.docs_search_results()}
          className="flex flex-col divide-y divide-border"
        >
          {results.map(({ article, excerpt }) => (
            <li key={article.id} className="flex flex-col gap-2 py-5 first:pt-0">
              <Link
                to="/docs/$category/$slug"
                params={{ category: article.category, slug: article.slug }}
                preload={false}
                className="flex min-h-11 w-fit items-center text-lg font-semibold text-primary underline-offset-4 hover:underline md:min-h-0"
              >
                {article.title}
              </Link>
              <p className="text-sm wrap-anywhere text-muted-foreground">{excerpt}</p>
              <a
                href={article.source}
                className="flex min-h-11 w-fit items-center py-2 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground md:min-h-0"
              >
                {m.docs_search_source()}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
