import MiniSearch from 'minisearch'

export type DocsSearchArticle = {
  readonly id: string
  readonly category: string
  readonly slug: string
  readonly route: string
  readonly title: string
  readonly excerpt: string
  readonly text: string
  readonly source: string
  readonly digest: string
}

const indexes = new WeakMap<
  ReadonlyArray<DocsSearchArticle>,
  MiniSearch<DocsSearchArticle>
>()

export function searchDocs(articles: ReadonlyArray<DocsSearchArticle>, query: string) {
  if (query.trim().length === 0) {
    return []
  }
  let index = indexes.get(articles)
  if (!index) {
    index = new MiniSearch<DocsSearchArticle>({
      fields: ['title', 'category', 'excerpt', 'text'],
      searchOptions: {
        boost: { title: 10 },
        prefix: true,
        fuzzy: 0.2,
        combineWith: 'AND'
      }
    })
    index.addAll(articles)
    indexes.set(articles, index)
  }
  const byId = new Map(articles.map((article) => [article.id, article]))
  return index
    .search(query)
    .flatMap((result) => {
      const article = byId.get(String(result.id))
      if (!article) {
        return []
      }
      const text = `${article.excerpt} ${article.text}`
      const normalizedText = text.toLowerCase()
      const positions = result.terms.flatMap((term) => {
        const position = normalizedText.indexOf(term)
        return position === -1 ? [] : [position]
      })
      const match = positions.length > 0 ? Math.min(...positions) : 0
      const start = Math.max(0, match - 60)
      const end = Math.min(text.length, start + 240)
      const boundary = end < text.length ? text.lastIndexOf(' ', end) : end
      const excerptEnd = boundary > start ? boundary : end
      const excerpt = `${start > 0 ? '…' : ''}${text.slice(start, excerptEnd).trim()}${end < text.length ? '…' : ''}`
      return [{ article, excerpt, score: result.score }]
    })
    .toSorted((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score
      }
      return a.article.id < b.article.id ? -1 : Number(a.article.id > b.article.id)
    })
}
