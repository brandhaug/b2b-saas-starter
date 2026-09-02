type Organization = {
  readonly '@type': 'Organization'
  readonly name: string
}

const PUBLISHER: Organization = { '@type': 'Organization', name: 'B2B SaaS Starter' }

/**
 * The article node of a content page's structured data. `@type` is the
 * schema.org kind the page claims to be (`TechArticle` for docs,
 * `BlogPosting` for the blog); the rest is the frontmatter each one carries.
 */
export type ContentArticleNode = {
  readonly '@type': 'TechArticle' | 'BlogPosting'
  readonly headline: string
  readonly description: string
  readonly keywords: string
  readonly datePublished?: string
  readonly author?: Organization
}

/**
 * The `application/ld+json` payload for a content page: one article node plus
 * the breadcrumb trail that led to it, already serialized for the `<script>`.
 *
 * The docs and blog routes built this graph inline and identically apart from
 * the article node, so the shape lives here and each content module supplies
 * only its own node — see `docJsonLd` in `docs.ts` and `postJsonLd` in
 * `blog.ts`.
 */
export function contentJsonLd({
  article,
  breadcrumb
}: {
  readonly article: ContentArticleNode
  readonly breadcrumb: ReadonlyArray<string>
}): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { ...article, publisher: PUBLISHER },
      {
        '@type': 'BreadcrumbList',
        itemListElement: breadcrumb.map((name, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name
        }))
      }
    ]
  })
}
