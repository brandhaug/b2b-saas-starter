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

export function searchDocs(articles: ReadonlyArray<DocsSearchArticle>, query: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) {
    return []
  }
  return articles
    .flatMap((article) => {
      const title = article.title.toLowerCase()
      const text = `${article.excerpt} ${article.text}`
      const searchable = `${title} ${article.category} ${text.toLowerCase()}`
      if (!terms.every((term) => searchable.includes(term))) {
        return []
      }
      const score = terms.reduce(
        (total, term) => total + (title.includes(term) ? 10 : 1),
        0
      )
      const match = text.toLowerCase().indexOf(terms[0] ?? '')
      const start = match > 60 ? text.lastIndexOf(' ', match - 60) + 1 : 0
      const end = Math.min(text.length, start + 240)
      const boundary = end < text.length ? text.lastIndexOf(' ', end) : end
      const excerptEnd = boundary > start ? boundary : end
      const excerpt = `${start > 0 ? '…' : ''}${text.slice(start, excerptEnd).trim()}${end < text.length ? '…' : ''}`
      return [{ article, excerpt, score }]
    })
    .toSorted((a, b) => b.score - a.score || a.article.id.localeCompare(b.article.id))
}
