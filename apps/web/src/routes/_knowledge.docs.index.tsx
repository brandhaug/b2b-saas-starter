import { createFileRoute, Link } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { ArrowRightIcon } from 'lucide-react'
import { DOC_CATEGORY_ORDER } from '@/lib/doc-categories'
import { docCategoryName, getAllDocMeta } from '@/lib/docs'
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
  const quickstart = docs.find(
    (doc) => doc.category === 'getting-started' && doc.slug === 'quickstart'
  )
  return (
    <div>
      <header className="mb-8">
        <h1 className="mb-2 text-3xl font-semibold">{m.public_docs_title()}</h1>
        <p className="text-sm text-muted-foreground">{m.public_docs_description()}</p>
      </header>

      {quickstart ? (
        <Link
          to="/docs/$category/$slug"
          params={{ category: quickstart.category, slug: quickstart.slug }}
          className="group mb-12 flex items-center justify-between gap-6 border border-primary/40 bg-card p-6 outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring sm:p-8"
        >
          <div>
            <h2 className="text-2xl font-semibold">{quickstart.frontmatter.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {quickstart.frontmatter.description}
            </p>
          </div>
          <ArrowRightIcon aria-hidden className="size-6 shrink-0 text-primary" />
        </Link>
      ) : null}
      <div className="grid gap-8">
        {DOC_CATEGORY_ORDER.map((slug) => {
          const articles = docs.filter(
            (doc) => doc.category === slug && doc !== quickstart
          )
          if (articles.length === 0) {
            return null
          }
          return (
            <section
              key={slug}
              className="grid gap-4 border-t border-border pt-6 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-8"
            >
              <div>
                <h2 className="text-lg font-semibold">{docCategoryName(slug)}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {m.public_docs_article_count({ count: articles.length })}
                </p>
              </div>
              <ul className="grid gap-x-8 sm:grid-cols-2">
                {articles.map((article) => (
                  <li key={article.slug}>
                    <Link
                      to="/docs/$category/$slug"
                      params={{ category: slug, slug: article.slug }}
                      className="group flex min-h-11 items-center justify-between gap-4 py-3 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                    >
                      {article.frontmatter.title}
                      <ArrowRightIcon
                        aria-hidden
                        className="size-3.5 shrink-0 self-center"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
