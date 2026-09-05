import { createFileRoute, Link } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { BookOpenIcon } from 'lucide-react'
import { DOC_CATEGORIES, DOC_CATEGORY_ORDER, getAllDocMeta } from '@/lib/docs'

export const Route = createFileRoute('/_knowledge/docs/')({
  loader: () => getAllDocMeta(),
  component: DocsIndex,
  head: () => ({
    meta: [
      { title: pageTitle('Documentation') },
      {
        name: 'description',
        content:
          'Concepts, recipes, and references for the starter architecture, capability interfaces, operations, and governance.'
      },
      { property: 'og:title', content: pageTitle('Documentation') },
      {
        property: 'og:description',
        content:
          'Concepts, recipes, and references for the starter architecture, capability interfaces, operations, and governance.'
      }
    ]
  })
})

function DocsIndex() {
  const docs = Route.useLoaderData()
  return (
    <div>
      <header className="mb-8">
        <h1 className="mb-2 text-3xl font-semibold">Documentation</h1>
        <p className="text-sm text-muted-foreground">
          Concepts and recipes for the starter architecture, modules, capability
          interfaces, and operations.
        </p>
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
                <h2 className="text-sm font-semibold">{DOC_CATEGORIES[slug]}</h2>
              </div>
              <p className="text-xs text-muted-foreground">
                {articles.length} {articles.length === 1 ? 'article' : 'articles'}
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
