import { createFileRoute, Link, Outlet, useMatches } from '@tanstack/react-router'
import { PublicLayout } from '@/components/public-layout'
import { DOC_CATEGORIES, DOC_CATEGORY_ORDER, getDocsByCategory } from '@/lib/docs'

export const Route = createFileRoute('/docs')({
  component: DocsLayout
})

function DocsLayout() {
  const matches = useMatches()
  const currentPath = matches[matches.length - 1]?.fullPath ?? ''

  return (
    <PublicLayout>
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-8 px-4 py-8 sm:px-6">
        <aside className="hidden w-60 shrink-0 md:block">
          <nav className="sticky top-20 flex flex-col gap-5">
            {DOC_CATEGORY_ORDER.map((slug) => {
              const articles = getDocsByCategory(slug)
              if (articles.length === 0) return null
              return (
                <div key={slug}>
                  <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-foreground">
                    {DOC_CATEGORIES[slug]}
                  </h3>
                  <ul className="flex flex-col gap-0.5">
                    {articles.map((article) => {
                      const articlePath = `/docs/${slug}/${article.slug}`
                      const isActive = currentPath === articlePath
                      return (
                        <li key={article.slug}>
                          <Link
                            to="/docs/$category/$slug"
                            params={{ category: slug, slug: article.slug }}
                            className={
                              isActive
                                ? 'block rounded-md bg-muted px-2 py-1 text-sm font-medium text-foreground'
                                : 'block rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground'
                            }
                          >
                            {article.frontmatter.title}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </nav>
        </aside>

        <main id="main-content" className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </PublicLayout>
  )
}
