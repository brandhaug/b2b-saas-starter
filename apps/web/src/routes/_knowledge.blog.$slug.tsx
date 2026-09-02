import { createFileRoute, Link, notFound, useLoaderData } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'
import { createElement, Suspense, useRef } from 'react'
import { mdxComponents } from '@/components/mdx-components'
import { TableOfContents } from '@/components/table-of-contents'
import { getPostComponent, loadPost, postJsonLd } from '@/lib/blog'
import { formatUtc } from '@/lib/format-date'

export const Route = createFileRoute('/_knowledge/blog/$slug')({
  // Metadata in the loader (serializable), component lazy-loaded below — see
  // docs.$category.$slug.tsx for why the component cannot ride loader data.
  loader: async ({ params }) => {
    const post = await loadPost(params.slug)
    if (!post) {
      throw notFound()
    }
    return { frontmatter: post.frontmatter }
  },
  component: BlogPostPage,
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {}
    }

    const { title, description, date, tags, author } = loaderData.frontmatter
    const fullTitle = `${title} | B2B SaaS Starter`

    return {
      meta: [
        { title: fullTitle },
        { name: 'description', content: description },
        { name: 'keywords', content: tags.join(', ') },
        { property: 'og:title', content: fullTitle },
        { property: 'og:description', content: description },
        { property: 'og:type', content: 'article' },
        { property: 'article:published_time', content: date },
        { property: 'article:author', content: author },
        { name: 'twitter:title', content: fullTitle },
        { name: 'twitter:description', content: description }
      ]
    }
  }
})

function BlogPostPage() {
  const { slug } = Route.useParams()
  const { frontmatter } = useLoaderData({ from: '/_knowledge/blog/$slug' })
  const articleRef = useRef<HTMLElement>(null)

  // Stable per-post identity (cached in lib/blog.ts).
  const LazyArticle = getPostComponent(slug)

  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: postJsonLd({ slug, frontmatter })
        }}
      />

      <div className="flex gap-8">
        <div className="mx-auto w-full max-w-3xl min-w-0 flex-1">
          <Link
            to="/blog"
            className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3" />
            Back to blog
          </Link>

          <header className="mb-8">
            <h1 className="font-display mb-2 text-3xl font-semibold tracking-tight">
              {frontmatter.title}
            </h1>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>{frontmatter.author}</span>
              <span>&middot;</span>
              <time dateTime={frontmatter.date}>
                {formatUtc(frontmatter.date, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </time>
            </div>
            {frontmatter.tags.length > 0 && (
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

          {/* In-page navigation below xl: the aside only exists from lg up,
                so most laptops and every phone used to read long articles with
                no way to jump sections. */}
          <details className="mb-6 border border-border xl:hidden">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
              On this page
            </summary>
            <div className="px-3 pt-1 pb-3">
              <TableOfContents containerRef={articleRef} />
            </div>
          </details>

          {LazyArticle === undefined ? (
            <p className="text-sm text-destructive">This post could not be loaded.</p>
          ) : (
            <article
              ref={articleRef}
              /* Token-mapped prose colors — see docs.$category.$slug.tsx. */
              className="prose max-w-none"
            >
              <Suspense
                fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
              >
                {/* createElement, not JSX: the component is resolved per post
                      at runtime, and React Compiler requires JSX component types
                      to be static module references. */}
                {createElement(LazyArticle, { components: mdxComponents })}
              </Suspense>
            </article>
          )}
        </div>

        <aside className="hidden w-48 shrink-0 lg:block">
          <TableOfContents containerRef={articleRef} />
        </aside>
      </div>
    </div>
  )
}
