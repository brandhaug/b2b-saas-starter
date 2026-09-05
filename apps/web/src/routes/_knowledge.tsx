import { createFileRoute, Link, Outlet, useLocation } from '@tanstack/react-router'
import {
  SectionSwitcher,
  type KnowledgeSection
} from '@/components/knowledge-section-switcher'
import { PublicLayout } from '@/components/public-layout'
import { getAllPostMeta, type PostMeta } from '@/lib/blog'
import {
  DOC_CATEGORIES,
  DOC_CATEGORY_ORDER,
  getAllDocMeta,
  type DocMeta
} from '@/lib/docs'

export const Route = createFileRoute('/_knowledge')({
  // Article metadata only — the compiled MDX itself loads per article (see
  // lib/docs.ts), so the layout's chunk carries titles, not article bodies.
  // Doc and post metadata resolve together: the section-aware sidebar lists
  // whichever one the current page belongs to.
  // oxlint-disable-next-line effect/noNewPromise -- TanStack loaders are promise-shaped; Promise.all keeps the two reads parallel
  loader: () => Promise.all([getAllDocMeta(), getAllPostMeta()]),
  component: KnowledgeLayout
})

/** The section a path belongs to; docs is the default. */
function sectionFor(pathname: string): KnowledgeSection {
  if (pathname.startsWith('/blog')) {
    return 'blog'
  }
  if (pathname.startsWith('/faq')) {
    return 'faq'
  }
  return 'docs'
}

/** The one active/inactive treatment for knowledge nav links. */
function knowledgeLinkClasses(isActive: boolean): string {
  return isActive
    ? 'block rounded-md bg-muted px-2 py-2 text-sm font-medium text-foreground'
    : 'block rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground'
}

type SectionLinksProps = {
  readonly section: KnowledgeSection
  readonly docs: ReadonlyArray<DocMeta>
  readonly posts: ReadonlyArray<PostMeta>
  readonly currentPath: string
}

/**
 * The current section's own list — never all sections at once. On /blog the
 * sidebar lists posts, on /faq the FAQ page; only /docs carries the doc
 * index. Group labels stay `<p>`s, not headings: the page's first heading is
 * the article <h1> in <main>, and an <h2>/<h3> here would skip levels in the
 * document outline.
 */
function SectionLinks({ section, docs, posts, currentPath }: SectionLinksProps) {
  if (section === 'blog') {
    return (
      <ul className="flex flex-col gap-0.5">
        {posts.map((post) => {
          const postPath = `/blog/${post.slug}`
          return (
            <li key={post.slug}>
              <Link
                to="/blog/$slug"
                params={{ slug: post.slug }}
                aria-current={currentPath === postPath ? 'page' : undefined}
                className={knowledgeLinkClasses(currentPath === postPath)}
              >
                {post.frontmatter.title}
              </Link>
            </li>
          )
        })}
      </ul>
    )
  }

  if (section === 'faq') {
    const isCurrent = currentPath === '/faq'
    return (
      <ul className="flex flex-col gap-0.5">
        <li>
          <Link
            to="/faq"
            aria-current={isCurrent ? 'page' : undefined}
            className={knowledgeLinkClasses(isCurrent)}
          >
            Frequently asked questions
          </Link>
        </li>
      </ul>
    )
  }

  return (
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
                      aria-current={currentPath === articlePath ? 'page' : undefined}
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
  )
}

/**
 * The one knowledge shell: docs, blog, and FAQ render inside this pathless
 * layout — a section-aware left nav, one article column, and each article
 * page's own table of contents with its below-lg disclosure. URLs are
 * unchanged: the layout is pathless, so `/docs`, `/blog`, and `/faq` keep
 * their addresses.
 */
function KnowledgeLayout() {
  const [docs, posts] = Route.useLoaderData()
  const pathname = useLocation().pathname
  const section = sectionFor(pathname)

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
        <details className="w-full border border-border md:hidden">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
            Knowledge sections
          </summary>
          <div className="flex flex-col gap-4 px-3 pt-1 pb-3">
            <SectionSwitcher current={section} />
            <nav aria-label="Knowledge">
              <SectionLinks
                section={section}
                docs={docs}
                posts={posts}
                currentPath={pathname}
              />
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
            <SectionSwitcher current={section} />
            <nav aria-label="Knowledge" className="flex-1 overflow-y-auto pr-1 pb-4">
              <SectionLinks
                section={section}
                docs={docs}
                posts={posts}
                currentPath={pathname}
              />
            </nav>
          </div>
        </aside>

        <main id="main-content" className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </PublicLayout>
  )
}
