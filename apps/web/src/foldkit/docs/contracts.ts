import { Schema } from 'effect'
import { m } from '@b2b-saas-starter/i18n/messages'
import { DOC_CATEGORY_ORDER, isDocCategory } from '../../lib/doc-categories'

export const DocMeta = Schema.Struct({
  slug: Schema.String,
  category: Schema.String,
  frontmatter: Schema.Struct({
    title: Schema.String,
    description: Schema.String,
    category: Schema.optional(Schema.String),
    order: Schema.optional(Schema.Number),
    tags: Schema.optional(Schema.Array(Schema.String)),
    updated: Schema.optional(Schema.String)
  })
})
export type DocMeta = typeof DocMeta.Type
export const Heading = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  level: Schema.Literals([2, 3])
})
export const SearchArticle = Schema.Struct({
  id: Schema.String,
  category: Schema.String,
  slug: Schema.String,
  route: Schema.String,
  title: Schema.String,
  excerpt: Schema.String,
  text: Schema.String,
  source: Schema.String,
  digest: Schema.String
})
export const Flags = Schema.TaggedUnion({
  Article: {
    meta: DocMeta,
    html: Schema.String,
    headings: Schema.Array(Heading),
    jsonLd: Schema.String,
    prev: Schema.NullOr(DocMeta),
    next: Schema.NullOr(DocMeta)
  },
  Search: { query: Schema.String, articles: Schema.Array(SearchArticle) }
})
export type Flags = typeof Flags.Type

export function categoryName(category: string): string {
  if (!isDocCategory(category)) {
    return category
  }
  const labels = [
    m.public_docs_category_getting_started(),
    m.public_docs_category_architecture(),
    m.public_docs_category_capability_interfaces(),
    m.public_docs_category_integrations(),
    m.public_docs_category_operations(),
    m.public_docs_category_governance()
  ]
  return labels[DOC_CATEGORY_ORDER.indexOf(category)] ?? category
}

export function docPath(doc: DocMeta): string {
  return `/docs/${doc.category}/${doc.slug}`
}
