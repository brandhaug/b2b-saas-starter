import { createFileRoute, Link } from '@tanstack/react-router'
import { PublicLayout } from '@/components/public-layout'
import { getAllPosts } from '@/lib/blog'

export const Route = createFileRoute('/blog/')({
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
  const posts = getAllPosts()

  return (
    <PublicLayout>
      <main id="main-content" className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Blog</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Articles about the technology and library decisions in this starter.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <Link
              key={post.slug}
              to="/blog/$slug"
              params={{ slug: post.slug }}
              className="group flex flex-col gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <h2 className="text-sm font-medium group-hover:text-primary">
                {post.frontmatter.title}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {post.frontmatter.description}
              </p>
              <time className="mt-auto pt-2 text-xs text-muted-foreground">
                {new Date(post.frontmatter.date).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </time>
            </Link>
          ))}
        </div>
      </main>
    </PublicLayout>
  )
}
