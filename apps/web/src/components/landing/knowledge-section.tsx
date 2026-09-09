import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { type DocMeta } from '@/lib/docs'
import { m } from '@b2b-saas-starter/i18n/messages'

function KnowledgeSection({
  recentDocs
}: {
  /** The home route's loader resolves these (lazy globs — see lib/docs.ts). */
  readonly recentDocs: ReadonlyArray<DocMeta>
}) {
  return (
    <section className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
      <h2 className="font-display text-balance text-3xl font-semibold sm:text-4xl">
        {m.public_knowledge_heading()}
      </h2>
      <p className="mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
        {m.public_knowledge_description()}
      </p>
      <div className="mt-12">
        <div>
          <p className="border-b border-border pb-3 font-mono text-xs text-muted-foreground">
            {m.public_knowledge_docs()}
          </p>
          <ul>
            {recentDocs.map((doc) => (
              <li key={`${doc.category}/${doc.slug}`}>
                <Link
                  to="/docs/$category/$slug"
                  params={{ category: doc.category, slug: doc.slug }}
                  className="group -mx-3 flex items-baseline justify-between gap-6 border-b border-border px-3 py-4 transition-colors hover:bg-accent/40"
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
      </div>
    </section>
  )
}

export { KnowledgeSection }
