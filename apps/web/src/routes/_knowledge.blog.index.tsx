import { createFileRoute, Link } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { getAllPostMeta } from '@/lib/blog'
import { formatTimestamp } from '@/lib/format-date'
import { m } from '@b2b-saas-starter/i18n/messages'

export const Route = createFileRoute('/_knowledge/blog/')({
  loader: () => getAllPostMeta(),
  component: BlogIndexPage,
  head: () => ({
    meta: [
      { title: pageTitle(m.public_blog_title()) },
      {
        name: 'description',
        content: m.public_blog_description()
      },
      { property: 'og:title', content: pageTitle(m.public_blog_title()) },
      {
        property: 'og:description',
        content: m.public_blog_description()
      }
    ]
  })
})

function BlogIndexPage() {
  const posts = Route.useLoaderData()

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-3xl font-semibold">{m.public_blog_title()}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {m.public_blog_description()}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {posts.map((post) => (
          <Link
            key={post.slug}
            to="/blog/$slug"
            params={{ slug: post.slug }}
            className="group flex flex-col gap-2 rounded-none border border-border bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <h2 className="text-base font-semibold group-hover:text-primary">
              {post.frontmatter.title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {post.frontmatter.description}
            </p>
            <time
              dateTime={post.frontmatter.date}
              className="mt-auto pt-2 text-xs text-muted-foreground"
            >
              {formatTimestamp(post.frontmatter.date, {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </time>
          </Link>
        ))}
      </div>
    </div>
  )
}
