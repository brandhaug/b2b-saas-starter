import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { type PostMeta } from '@/lib/blog'
import { type DocMeta } from '@/lib/docs'
import { formatUtc } from '@/lib/format-date'

function KnowledgeSection({
  recentDocs,
  recentPosts
}: {
  /** The home route's loader resolves these (lazy globs — see lib/docs.ts). */
  readonly recentDocs: ReadonlyArray<DocMeta>
  readonly recentPosts: ReadonlyArray<PostMeta>
}) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <h2 className="font-display text-balance text-3xl font-semibold sm:text-4xl">
        The reasoning is checked in.
      </h2>
      <p className="mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
        Docs, FAQ, and blog are versioned MDX in the repo, searched from generated
        indexes, no CMS. The blog explains why each technology call was made, and
        releases are cut by release-please.
      </p>
      <div className="mt-12 grid gap-x-20 gap-y-14 lg:grid-cols-2">
        <div>
          <p className="border-b border-border pb-3 font-mono text-xs text-muted-foreground">
            docs/
          </p>
          <ul>
            {recentDocs.map((doc) => (
              <li key={`${doc.category}/${doc.slug}`}>
                <Link
                  to="/docs/$category/$slug"
                  params={{ category: doc.category, slug: doc.slug }}
                  className="group flex items-baseline justify-between gap-6 border-b border-border py-4 transition-colors hover:bg-accent/40"
                >
                  <span>
                    <span className="block text-sm font-medium group-hover:text-primary">
                      {doc.frontmatter.title}
                    </span>
                    <span className="mt-1 line-clamp-1 block text-xs text-muted-foreground">
                      {doc.frontmatter.description}
                    </span>
                  </span>
                  <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="border-b border-border pb-3 font-mono text-xs text-muted-foreground">
            blog/
          </p>
          <ul>
            {recentPosts.map((post) => (
              <li key={post.slug}>
                <Link
                  to="/blog/$slug"
                  params={{ slug: post.slug }}
                  className="group block border-b border-border py-4 transition-colors hover:bg-accent/40"
                >
                  <span className="flex items-baseline justify-between gap-6">
                    <span className="text-sm font-medium group-hover:text-primary">
                      {post.frontmatter.title}
                    </span>
                    <time className="shrink-0 font-mono text-xs text-muted-foreground">
                      {formatUtc(post.frontmatter.date, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </time>
                  </span>
                  <span className="mt-1 line-clamp-1 block text-xs text-muted-foreground">
                    {post.frontmatter.description}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

export { KnowledgeSection }
