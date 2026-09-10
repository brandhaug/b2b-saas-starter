import { createFileRoute, Link, Outlet, useLocation } from '@tanstack/react-router'
import { ChevronDownIcon } from 'lucide-react'
import { PublicLayout } from '@/components/public-layout'
import { DOC_CATEGORY_ORDER } from '@/lib/doc-categories'
import { docCategoryName, getAllDocMeta, type DocMeta } from '@/lib/docs'
import { m } from '@b2b-saas-starter/i18n/messages'

export const Route = createFileRoute('/_knowledge')({
  // Article metadata only — the compiled MDX itself loads per article (see
  // lib/docs.ts), so the layout's chunk carries titles, not article bodies.
  loader: () => getAllDocMeta(),
  component: KnowledgeLayout
})

/** The one active/inactive treatment for knowledge nav links. */
function knowledgeLinkClasses(isActive: boolean, compact = false): string {
  const textSize = compact ? 'text-xs' : 'text-sm'
  return isActive
    ? `block rounded-md bg-muted px-2 py-2 ${textSize} font-medium text-foreground`
    : `block rounded-md px-2 py-2 ${textSize} text-muted-foreground transition-colors hover:text-foreground`
}

type SectionLinksProps = {
  readonly docs: ReadonlyArray<DocMeta>
  readonly currentPath: string
}

/**
 * The docs sidebar list. Group labels stay `<p>`s, not headings: the page's first heading is
 * the article <h1> in <main>, and an <h2>/<h3> here would skip levels in the
 * document outline.
 */
function SectionLinks({ docs, currentPath }: SectionLinksProps) {
  return (
    <ul className="flex flex-col gap-0.5">
      {DOC_CATEGORY_ORDER.map((slug) => {
        const articles = docs.filter((doc) => doc.category === slug)
        if (articles.length === 0) {
          return null
        }
        return (
          <li key={slug} className="mt-2 first:mt-0">
            <p className="px-2 pb-1 text-sm font-semibold text-foreground">
              {docCategoryName(slug)}
            </p>
            <ul className="flex flex-col gap-0.5">
              {articles.map((article) => {
                const articlePath = `/docs/${slug}/${article.slug}`
                return (
                  <li key={article.slug}>
                    <Link
                      to="/docs/$category/$slug"
                      params={{ category: slug, slug: article.slug }}
                      aria-current={currentPath === articlePath ? 'page' : undefined}
                      className={knowledgeLinkClasses(
                        currentPath === articlePath,
                        true
                      )}
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
  )
}

/**
 * The docs shell: a left nav, one article column, and each article page's
 * own table of contents with its below-lg disclosure.
 */
function KnowledgeLayout() {
  const docs = Route.useLoaderData()
  const pathname = useLocation().pathname

  return (
    <PublicLayout>
      {/* Column on mobile (disclosure above content), row from md up. The two
          copies are breakpoint-complementary (`md:hidden` vs `hidden md:block`),
          so exactly one <nav aria-label="Knowledge"> is ever in the
          accessibility tree. */}
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 md:flex-row">
        {/* Below md the sidebar is gone, which used to leave every phone
            reader with no in-page navigation at all — a disclosure carries
            the same nav instead. */}
        <details className="group w-full border border-border md:hidden">
          {/* The native disclosure triangle belongs to no design system:
              hide it and draw the same chevron the rest of the app uses. */}
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
            {m.public_knowledge_sections()}
            <ChevronDownIcon
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            />
          </summary>
          <div className="flex flex-col gap-4 px-3 pt-1 pb-3">
            <nav aria-label={m.public_knowledge_nav()}>
              <SectionLinks docs={docs} currentPath={pathname} />
            </nav>
          </div>
        </details>
        <aside className="hidden w-60 shrink-0 md:block">
          {/* The switcher stays pinned above the list; the list itself scrolls
              when a section (docs has six categories) outgrows the viewport,
              so the current-page marker is always reachable. The max height
              subtracts the header the sidebar is pinned below: `top-18` plus
              `max-h-dvh` left the last 72px unreachable past the fold. */}
          <div className="sticky top-18 flex max-h-below-header flex-col gap-4">
            <nav
              aria-label={m.public_knowledge_nav()}
              className="flex-1 overflow-y-auto pr-1 pb-4"
            >
              <SectionLinks docs={docs} currentPath={pathname} />
            </nav>
          </div>
        </aside>

        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          <Outlet />
        </main>
      </div>
    </PublicLayout>
  )
}
