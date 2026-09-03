import { createFileRoute, Link, Outlet, useMatches } from '@tanstack/react-router'
import { PublicLayout } from '@/components/public-layout'
import {
  DOC_CATEGORIES,
  DOC_CATEGORY_ORDER,
  getAllDocMeta,
  type DocMeta
} from '@/lib/docs'

export const Route = createFileRoute('/_knowledge')({
  // Article metadata only — the compiled MDX itself loads per article (see
  // lib/docs.ts), so the layout's chunk carries titles, not article bodies.
  loader: () => getAllDocMeta(),
  component: KnowledgeLayout
})

type KnowledgeLink = {
  readonly to: '/blog' | '/changelog' | '/faq'
  readonly label: string
}

/** The non-docs sections the knowledge shell navigates between. */
const KNOWLEDGE_LINKS: ReadonlyArray<KnowledgeLink> = [
  { to: '/blog', label: 'Blog' },
  { to: '/changelog', label: 'Changelog' },
  { to: '/faq', label: 'FAQ' }
]

/** The one active/inactive treatment for knowledge nav links. */
function knowledgeLinkClasses(isActive: boolean): string {
  return isActive
    ? 'block rounded-md bg-muted px-2 py-2 text-sm font-medium text-foreground'
    : 'block rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground'
}

function KnowledgeNavLinks({
  docs,
  currentPath
}: {
  readonly docs: ReadonlyArray<DocMeta>
  readonly currentPath: string
}) {
  return (
    <>
      {/* Group label, not a heading: the page's first heading is the article
          <h1> in <main>, and an <h2>/<h3> here would skip levels in the
          document outline. */}
      <div>
        <p className="mb-1 text-xs font-semibold text-foreground">Documentation</p>
        <ul className="flex flex-col gap-0.5">
          {DOC_CATEGORY_ORDER.map((slug) => {
            const articles = docs.filter((doc) => doc.category === slug)
            if (articles.length === 0) {
              return null
            }
            return (
              <li key={slug} className="mt-2 first:mt-0">
                <p className="px-2 pb-0.5 text-2xs text-muted-foreground">
                  {DOC_CATEGORIES[slug]}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {articles.map((article) => {
                    const articlePath = `/docs/${slug}/${article.slug}`
                    return (
                      <li key={article.slug}>
                        <Link
                          to="/docs/$category/$slug"
                          params={{ category: slug, slug: article.slug }}
                          aria-current={
                            currentPath === articlePath ? 'page' : undefined
                          }
                          className={knowledgeLinkClasses(currentPath === articlePath)}
                        >
                          {article.frontmatter.title}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </li>
            )
          })}
        </ul>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold text-foreground">More</p>
        <ul className="flex flex-col gap-0.5">
          {KNOWLEDGE_LINKS.map((link) => (
            <li key={link.to}>
              <Link
                to={link.to}
                aria-current={currentPath === link.to ? 'page' : undefined}
                className={knowledgeLinkClasses(currentPath === link.to)}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

/**
 * The one knowledge shell: docs, blog, changelog, and FAQ render inside this
 * pathless layout — one collapsible left nav, one article column, and each
 * article page's own table of contents with its below-xl disclosure. URLs are
 * unchanged: the layout is pathless, so `/docs`, `/blog`, `/changelog`, and
 * `/faq` keep their addresses.
 */
function KnowledgeLayout() {
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
            Knowledge sections
          </summary>
          <nav aria-label="Knowledge" className="flex flex-col gap-5 px-3 pt-1 pb-3">
            <KnowledgeNavLinks docs={docs} currentPath={currentPath} />
          </nav>
        </details>
        <aside className="hidden w-60 shrink-0 md:block">
          <nav aria-label="Knowledge" className="sticky top-18 flex flex-col gap-5">
            <KnowledgeNavLinks docs={docs} currentPath={currentPath} />
          </nav>
        </aside>

        <main id="main-content" className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </PublicLayout>
  )
}
