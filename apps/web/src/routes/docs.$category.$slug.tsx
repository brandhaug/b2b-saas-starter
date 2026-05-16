import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'
import { useRef } from 'react'
import { mdxComponents } from '@/components/mdx-components'
import { TableOfContents } from '@/components/table-of-contents'
import {
  DOC_CATEGORIES,
  getAdjacentDocs,
  getDocBySlug,
  isDocCategory
} from '@/lib/docs'

export const Route = createFileRoute('/docs/$category/$slug')({
  loader: ({ params }) => {
    const article = getDocBySlug(params.category, params.slug)
    if (!article) throw notFound()
    const { prev, next } = getAdjacentDocs(params.category, params.slug)
    const categoryName = isDocCategory(params.category)
      ? DOC_CATEGORIES[params.category]
      : params.category
    const jsonLdString = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'TechArticle',
          headline: article.frontmatter.title,
          description: article.frontmatter.description,
          publisher: { '@type': 'Organization', name: 'B2B SaaS Starter' },
          keywords: (article.frontmatter.tags ?? []).join(', ')
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home' },
            { '@type': 'ListItem', position: 2, name: 'Documentation' },
            { '@type': 'ListItem', position: 3, name: categoryName },
            { '@type': 'ListItem', position: 4, name: article.frontmatter.title }
          ]
        }
      ]
    })
    return {
      article,
      categoryName,
      prevSlug: prev?.slug ?? null,
      prevTitle: prev?.frontmatter.title ?? null,
      nextSlug: next?.slug ?? null,
      nextTitle: next?.frontmatter.title ?? null,
      jsonLdString
    }
  },
  component: DocArticlePage,
  head: ({ params }) => {
    const article = getDocBySlug(params.category, params.slug)
    if (!article) return {}

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
  const { category } = Route.useParams()
  const articleRef = useRef<HTMLElement>(null)
  const {
    article,
    categoryName,
    prevSlug,
    prevTitle,
    nextSlug,
    nextTitle,
    jsonLdString
  } = Route.useLoaderData()

  const { Component, frontmatter } = article

  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString }}
      />

      <div className="flex gap-8">
        <div className="min-w-0 flex-1">
          <div className="mb-6 flex items-center gap-1 text-xs text-muted-foreground">
            <Link to="/docs" className="transition-colors hover:text-foreground">
              Documentation
            </Link>
            <span>/</span>
            <span>{categoryName}</span>
            <span>/</span>
            <span className="text-foreground">{frontmatter.title}</span>
          </div>

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
            className="prose prose-neutral max-w-none dark:prose-invert"
          >
            <Component components={mdxComponents} />
          </article>

          <nav className="mt-12 flex items-center justify-between gap-4 border-t border-border pt-4">
            {prevSlug && prevTitle ? (
              <Link
                to="/docs/$category/$slug"
                params={{ category, slug: prevSlug }}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeftIcon className="size-3" />
                {prevTitle}
              </Link>
            ) : (
              <span />
            )}
            {nextSlug && nextTitle ? (
              <Link
                to="/docs/$category/$slug"
                params={{ category, slug: nextSlug }}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {nextTitle} &rarr;
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
