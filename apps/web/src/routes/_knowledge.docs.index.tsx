import { createFileRoute, Link } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { BookOpenIcon } from 'lucide-react'
import { DOC_CATEGORY_ORDER, docCategoryName, getAllDocMeta } from '@/lib/docs'
import { m } from '@b2b-saas-starter/i18n/messages'

export const Route = createFileRoute('/_knowledge/docs/')({
  loader: () => getAllDocMeta(),
  component: DocsIndex,
  head: () => ({
    meta: [
      { title: pageTitle(m.public_docs_title()) },
      {
        name: 'description',
        content: m.public_docs_description()
      },
      { property: 'og:title', content: pageTitle(m.public_docs_title()) },
      {
        property: 'og:description',
        content: m.public_docs_description()
      }
    ]
  })
})

function DocsIndex() {
  const docs = Route.useLoaderData()
  return (
    <div>
      <header className="mb-8">
        <h1 className="mb-2 text-3xl font-semibold">{m.public_docs_title()}</h1>
        <p className="text-sm text-muted-foreground">{m.public_docs_description()}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DOC_CATEGORY_ORDER.map((slug) => {
          const articles = docs.filter((doc) => doc.category === slug)
          if (articles.length === 0) {
            return null
          }
          return (
            <div
              key={slug}
              className="flex flex-col gap-2 rounded-none border border-border bg-card p-4"
            >
              <div className="flex items-center gap-2">
                <BookOpenIcon className="size-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">{docCategoryName(slug)}</h2>
              </div>
              <p className="text-xs text-muted-foreground">
                {articles.length}{' '}
                {articles.length === 1
                  ? m.public_docs_article()
                  : m.public_docs_articles()}
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {articles.map((article) => (
                  <li key={article.slug}>
                    <Link
                      to="/docs/$category/$slug"
                      params={{ category: slug, slug: article.slug }}
                      className="block py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {article.frontmatter.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
