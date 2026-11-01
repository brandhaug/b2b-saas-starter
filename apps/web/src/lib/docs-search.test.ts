import { describe, expect, it } from 'vite-plus/test'
import { searchDocs, type DocsSearchArticle } from './docs-search'

function fixtureArticle(id: string, title: string, text = ''): DocsSearchArticle {
  return {
    id,
    title,
    text,
    category: 'guides',
    slug: id,
    route: `/docs/guides/${id}`,
    excerpt: '',
    source: '',
    digest: ''
  }
}

describe('documentation search', () => {
  const articles = [
    fixtureArticle('body', 'Setup', 'Authentication'),
    fixtureArticle('title', 'Authentication')
  ]

  it('ignores blank queries and requires every query term', () => {
    expect(searchDocs(articles, '  ')).toEqual([])
    expect(searchDocs(articles, 'authentication nonexistent')).toEqual([])
  })

  it('supports prefixes and typos with title boosting', () => {
    expect(searchDocs(articles, 'authent').map(({ article }) => article.id)).toEqual([
      'title',
      'body'
    ])
    expect(searchDocs(articles, 'authentcation')[0]?.article.id).toBe('title')
  })

  it('breaks equal scores by stable article ID regardless of input order', () => {
    const tied = [fixtureArticle('z', 'Setup'), fixtureArticle('a', 'Setup')]
    expect(searchDocs(tied, 'setup').map(({ article }) => article.id)).toEqual([
      'a',
      'z'
    ])
  })

  it('bounds excerpts even for long tokens and preserves text literally', () => {
    const result = searchDocs(
      [
        fixtureArticle(
          'a',
          'Setup',
          `${'x'.repeat(500)} <script>literal</script> setup`
        )
      ],
      'setup'
    )[0]
    expect(result?.excerpt.length).toBeLessThanOrEqual(242)
    expect(result?.excerpt).toContain('setup')
  })
})
