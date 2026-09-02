import { createFileRoute, Link, Outlet, useMatches } from '@tanstack/react-router'
import { PublicLayout } from '@/components/public-layout'
import {
  DOC_CATEGORIES,
  DOC_CATEGORY_ORDER,
  getAllDocMeta,
  type DocMeta
} from '@/lib/docs'

export const Route = createFileRoute('/docs')({
  // Article metadata only — the compiled MDX itself loads per article (see
  // lib/docs.ts), so the layout's chunk carries titles, not article bodies.
  loader: () => getAllDocMeta(),
  component: DocsLayout
})

function DocsNavLinks({
  docs,
  currentPath
}: {
  readonly docs: ReadonlyArray<DocMeta>
  readonly currentPath: string
}) {
  return (
    <>
      {DOC_CATEGORY_ORDER.map((slug) => {
        const articles = docs.filter((doc) => doc.category === slug)
        if (articles.length === 0) {
          return null
        }
        return (
          <div key={slug}>
            {/* Group label, not a heading: the page's first heading is the
                article <h1> in <main>, and an <h2>/<h3> here would skip
                levels in the document outline. */}
            <p className="mb-1 text-xs font-semibold text-foreground">
              {DOC_CATEGORIES[slug]}
            </p>
            <ul className="flex flex-col gap-0.5">
              {articles.map((article) => {
                const articlePath = `/docs/${slug}/${article.slug}`
                const isActive = currentPath === articlePath
                return (
                  <li key={article.slug}>
                    <Link
                      to="/docs/$category/$slug"
                      params={{ category: slug, slug: article.slug }}
                      aria-current={isActive ? 'page' : undefined}
                      className={
                        isActive
                          ? 'block rounded-md bg-muted px-2 py-2 text-sm font-medium text-foreground'
                          : 'block rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground'
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
    </>
  )
}

function DocsLayout() {
  const docs = Route.useLoaderData()
  const matches = useMatches()
  const currentPath = matches.at(-1)?.fullPath ?? ''

  return (
    <PublicLayout>
      {/* Column on mobile (disclosure above content), row from md up. */}
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 md:flex-row">
        {/* Below md the sidebar is gone, which used to leave every phone
            reader with no in-page navigation at all — a disclosure carries
            the same nav instead. */}
        <details className="w-full border border-border md:hidden">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
            Documentation sections
          </summary>
          <nav
            aria-label="Documentation"
            className="flex flex-col gap-5 px-3 pt-1 pb-3"
          >
            <DocsNavLinks docs={docs} currentPath={currentPath} />
          </nav>
        </details>
        <aside className="hidden w-60 shrink-0 md:block">
          <nav aria-label="Documentation" className="sticky top-18 flex flex-col gap-5">
            <DocsNavLinks docs={docs} currentPath={currentPath} />
          </nav>
        </aside>

        <main id="main-content" className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </PublicLayout>
  )
}
