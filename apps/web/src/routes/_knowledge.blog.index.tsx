import { createFileRoute, Link } from '@tanstack/react-router'
import { getAllPostMeta } from '@/lib/blog'
import { formatUtc } from '@/lib/format-date'

export const Route = createFileRoute('/_knowledge/blog/')({
  loader: () => getAllPostMeta(),
  component: BlogIndexPage,
  head: () => ({
    meta: [
      { title: 'Blog | B2B SaaS Starter' },
      {
        name: 'description',
        content:
          'Articles about the technology and library decisions in the B2B SaaS Starter.'
      },
      { property: 'og:title', content: 'Blog | B2B SaaS Starter' },
      {
        property: 'og:description',
        content:
          'Articles about the technology and library decisions in the B2B SaaS Starter.'
      }
    ]
  })
})

function BlogIndexPage() {
  const posts = Route.useLoaderData()

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Blog</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Articles about the technology and library decisions in this starter.
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
              {formatUtc(post.frontmatter.date, {
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
