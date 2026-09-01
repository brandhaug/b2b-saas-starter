import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'
import { useRef } from 'react'
import { mdxComponents } from '@/components/mdx-components'
import { PublicLayout } from '@/components/public-layout'
import { TableOfContents } from '@/components/table-of-contents'
import { getPostBySlug } from '@/lib/blog'

export const Route = createFileRoute('/blog/$slug')({
  loader: ({ params }) => {
    const post = getPostBySlug(params.slug)
    if (!post) {
      throw notFound()
    }
    const jsonLdString = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'BlogPosting',
          headline: post.frontmatter.title,
          description: post.frontmatter.description,
          datePublished: post.frontmatter.date,
          author: { '@type': 'Organization', name: post.frontmatter.author },
          publisher: { '@type': 'Organization', name: 'B2B SaaS Starter' },
          keywords: post.frontmatter.tags.join(', ')
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home' },
            { '@type': 'ListItem', position: 2, name: 'Blog' },
            { '@type': 'ListItem', position: 3, name: post.frontmatter.title }
          ]
        }
      ]
    })
    // See docs.$category.$slug.tsx: the MDX component is a function and
    // cannot ride in loader data — shipping it aborts dehydration and the
    // page blanks on hydration. Ship the serializable subset only.
    return {
      post: {
        slug: post.slug,
        frontmatter: post.frontmatter
      },
      jsonLdString
    }
  },
  component: BlogPostPage,
  head: ({ params }) => {
    const post = getPostBySlug(params.slug)
    if (!post) {
      return {}
    }

    const { title, description, date, tags, author } = post.frontmatter
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
  const { post, jsonLdString } = Route.useLoaderData()
  const articleRef = useRef<HTMLElement>(null)
  // See the loader: `Component` is re-resolved from the module map because
  // functions cannot cross the server→client boundary. The loader's
  // notFound() guard guarantees this hit.
  const resolvedPost = getPostBySlug(post.slug)
  if (!resolvedPost) {
    throw notFound()
  }
  const { Component, frontmatter } = resolvedPost

  return (
    <PublicLayout>
      <main id="main-content" className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdString }}
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
              <h1 className="mb-2 text-3xl font-semibold tracking-tight">
                {frontmatter.title}
              </h1>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span>{frontmatter.author}</span>
                <span>&middot;</span>
                <time dateTime={frontmatter.date}>
                  {new Date(frontmatter.date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    timeZone: 'UTC'
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

            <article
              ref={articleRef}
              /* Token-mapped prose colors — see docs.$category.$slug.tsx. */
              className="prose max-w-none"
            >
              <Component components={mdxComponents} />
            </article>
          </div>

          <aside className="hidden w-48 shrink-0 xl:block">
            <TableOfContents containerRef={articleRef} />
          </aside>
        </div>
      </main>
    </PublicLayout>
  )
}
