import { createFileRoute, Link, notFound, useLoaderData } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { ArrowLeftIcon } from 'lucide-react'
import { createElement, Suspense, useRef } from 'react'
import { mdxComponents } from '@/components/mdx-components'
import { TableOfContents } from '@/components/table-of-contents'
import {
  docCategoryName,
  docJsonLd,
  getAllDocMeta,
  getAdjacentDocs,
  getDocComponent,
  loadDoc
} from '@/lib/docs'

export const Route = createFileRoute('/_knowledge/docs/$category/$slug')({
  // The loader resolves metadata (serializable) and decides existence; the
  // component itself is lazy-loaded in the component below, because a
  // component function cannot cross the server→client boundary — shipping
  // one aborts dehydration and the page blanks on hydration.
  loader: async ({ params }) => {
    // One parallel round: article metadata and the full index resolve together.
    // oxlint-disable-next-line effect/noNewPromise -- TanStack loaders are promise-shaped; Promise.all keeps the two reads parallel
    const [doc, allMeta] = await Promise.all([
      loadDoc(params.category, params.slug),
      getAllDocMeta()
    ])
    if (!doc) {
      throw notFound()
    }
    const { prev, next } = getAdjacentDocs(allMeta, params.category, params.slug)
    return {
      frontmatter: doc.frontmatter,
      categoryName: docCategoryName(params.category),
      prev: prev
        ? { category: prev.category, slug: prev.slug, title: prev.frontmatter.title }
        : null,
      next: next
        ? { category: next.category, slug: next.slug, title: next.frontmatter.title }
        : null
    }
  },
  component: DocArticlePage,
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {}
    }
    const { title, description, tags } = loaderData.frontmatter
    const fullTitle = pageTitle(title, 'Documentation')

    return {
      meta: [
        { title: fullTitle },
        { name: 'description', content: description },
        ...(tags && tags.length > 0
          ? [{ name: 'keywords', content: tags.join(', ') }]
          : []),
        { property: 'og:title', content: fullTitle },
        { property: 'og:description', content: description },
        { property: 'og:type', content: 'article' },
        { name: 'twitter:title', content: fullTitle },
        { name: 'twitter:description', content: description }
      ]
    }
  }
})

function DocArticlePage() {
  const { category, slug } = Route.useParams()
  const loaderData = useLoaderData({ from: '/_knowledge/docs/$category/$slug' })
  const articleRef = useRef<HTMLElement>(null)

  // Stable per-article identity (cached in lib/docs.ts), so a re-render
  // never remounts the body mid-read.
  const LazyArticle = getDocComponent(category, slug)

  const { frontmatter, categoryName, prev, next } = loaderData

  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: docJsonLd({ slug, category, frontmatter })
        }}
      />

      <div className="flex gap-8">
        <div className="min-w-0 flex-1">
          <nav aria-label="Breadcrumb" className="mb-6 text-xs text-muted-foreground">
            <ol className="flex flex-wrap items-center gap-1">
              <li>
                <Link to="/docs" className="transition-colors hover:text-foreground">
                  Documentation
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li>{categoryName}</li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="text-foreground">
                {frontmatter.title}
              </li>
            </ol>
          </nav>

          <header className="mb-8">
            <h1 className="mb-2 text-3xl font-semibold">{frontmatter.title}</h1>
            <p className="text-sm text-muted-foreground">{frontmatter.description}</p>
            {frontmatter.tags && frontmatter.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {frontmatter.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </header>

          {/* In-page navigation below lg: the aside takes over from lg up, and
              the two breakpoints are complementary — with `xl:hidden` here both
              copies were on screen (and both named landmarks reached axe)
              between lg and xl. */}
          <details className="mb-6 border border-border lg:hidden">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
              On this page
            </summary>
            <div className="px-3 pt-1 pb-3">
              <TableOfContents containerRef={articleRef} />
            </div>
          </details>

          {LazyArticle === undefined ? (
            <p className="text-sm text-destructive">
              This article could not be loaded.
            </p>
          ) : (
            <article
              ref={articleRef}
              /* Colors come from the `.marketing .prose` token map in index.css;
                 `prose-neutral` would hardcode a gray palette that clashes with
                 Catppuccin and can fail AA in dark mode. Prose headings sit
                 below the page h1's text-3xl — a section heading must never
                 outrank the title of the page it belongs to. */
              className="prose prose-lg max-w-3xl prose-h2:text-xl prose-h3:text-base"
            >
              <Suspense
                fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
              >
                {/* createElement, not JSX: the component is resolved per article at runtime, and React Compiler requires JSX component types to be static. */}
                {createElement(LazyArticle, { components: mdxComponents })}
              </Suspense>
            </article>
          )}

          <nav
            aria-label="Adjacent articles"
            className="mt-12 flex items-center justify-between gap-4 border-t border-border pt-4"
          >
            {prev ? (
              <Link
                to="/docs/$category/$slug"
                params={{ category: prev.category, slug: prev.slug }}
                className="inline-flex items-center gap-1 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeftIcon className="size-3" />
                {prev.title}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link
                to="/docs/$category/$slug"
                params={{ category: next.category, slug: next.slug }}
                className="py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {next.title} &rarr;
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </div>

        <aside className="hidden w-48 shrink-0 lg:block">
          <TableOfContents containerRef={articleRef} />
        </aside>
      </div>
    </div>
  )
}
