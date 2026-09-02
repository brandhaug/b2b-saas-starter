import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'
import { useRef } from 'react'
import { mdxComponents } from '@/components/mdx-components'
import { TableOfContents } from '@/components/table-of-contents'
import { docCategoryName, docJsonLd, getAdjacentDocs, getDocBySlug } from '@/lib/docs'

export const Route = createFileRoute('/docs/$category/$slug')({
  // A bare guard: `getDocBySlug` is a synchronous lookup over checked-in MDX,
  // and the component has to re-resolve the module anyway — `Component` is a
  // function, and functions cannot cross the server→client boundary (shipping
  // one aborts dehydration and the page blanks on hydration). So the loader
  // decides only whether the page exists.
  loader: ({ params }) => {
    if (!getDocBySlug(params.category, params.slug)) {
      throw notFound()
    }
  },
  component: DocArticlePage,
  head: ({ params }) => {
    const article = getDocBySlug(params.category, params.slug)
    if (!article) {
      return {}
    }

    const { title, description, tags } = article.frontmatter
    const fullTitle = `${title} | Documentation | B2B SaaS Starter`

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
  const articleRef = useRef<HTMLElement>(null)

  // Resolved here rather than shipped from the loader — see the loader.
  const doc = getDocBySlug(category, slug)
  if (!doc) {
    throw notFound()
  }
  const { Component, frontmatter } = doc
  const categoryName = docCategoryName(category)
  const { prev, next } = getAdjacentDocs(category, slug)

  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: docJsonLd(doc) }}
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
            <h1 className="mb-2 text-2xl font-semibold tracking-tight">
              {frontmatter.title}
            </h1>
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

          <article
            ref={articleRef}
            /* Colors come from the `.marketing .prose` token map in index.css;
               `prose-neutral` would hardcode a gray palette that clashes with
               Catppuccin and can fail AA in dark mode. */
            className="prose max-w-3xl"
          >
            <Component components={mdxComponents} />
          </article>

          <nav
            aria-label="Adjacent articles"
            className="mt-12 flex items-center justify-between gap-4 border-t border-border pt-4"
          >
            {prev ? (
              <Link
                to="/docs/$category/$slug"
                params={{ category, slug: prev.slug }}
                className="inline-flex items-center gap-1 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeftIcon className="size-3" />
                {prev.frontmatter.title}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link
                to="/docs/$category/$slug"
                params={{ category, slug: next.slug }}
                className="py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {next.frontmatter.title} &rarr;
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </div>

        <aside className="hidden w-48 shrink-0 xl:block">
          <TableOfContents containerRef={articleRef} />
        </aside>
      </div>
    </div>
  )
}
