import { render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'
import { AssistantMarkdown } from './assistant-markdown'

// Boundary failures: executable HTML/URLs, SSR image preloads, disappearing partial
// fragments, duplicate footnote targets, and invalid block nesting in consumers.
describe('assistant Markdown boundary', () => {
  it('omits raw HTML, keeps unsafe links inert and renders image alt text without preloads', () => {
    const text = [
      '<script>alert(1)</script>',
      '',
      '<iframe src="https://unsafe.example/frame"></iframe>',
      '',
      '[unsafe](javascript:alert%281%29) [data](data:text/html,hello)',
      '',
      '![Evidence diagram](https://images.example/tracker.png)',
      '',
      '[Documentation](https://example.com/docs)'
    ].join('\n')
    const html = renderToStaticMarkup(<AssistantMarkdown text={text} />)
    expect(html).not.toMatch(/<(?:script|iframe|img|link)\b/)
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('data:text')
    expect(html).not.toContain('images.example')
    render(<AssistantMarkdown text={text} />)
    expect(screen.getByText('Evidence diagram')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'unsafe' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'data' })).toBeNull()
    expect(
      screen.getByRole('link', { name: 'Documentation' }).getAttribute('href')
    ).toBe('https://example.com/docs')
  })

  it('keeps incomplete fences and links readable as an answer grows', () => {
    const { container, rerender } = render(
      <AssistantMarkdown text={'## Result\n\n```ts\nconst count = 1'} />
    )
    expect(container.querySelector('pre code')?.textContent).toContain(
      'const count = 1'
    )
    expect(container.querySelector('h1')).toBeNull()
    rerender(
      <AssistantMarkdown
        text={'## Result\n\n```ts\nconst count = 1\n```\n\n[Read more](https://exa'}
      />
    )
    expect(container.textContent).toContain('Read more')
    rerender(
      <AssistantMarkdown
        text={
          '## Result\n\n```ts\nconst count = 1\n```\n\n[Read more](https://example.com)'
        }
      />
    )
    expect(screen.getByRole('link', { name: 'Read more' }).getAttribute('href')).toBe(
      'https://example.com'
    )
    expect(container.querySelector('pre code')?.textContent).toContain(
      'const count = 1'
    )
  })

  it('gives repeated footnotes distinct targets in separate answers', () => {
    const text = 'Evidence[^source]\n\n[^source]: Saved observation.'
    const { container } = render(
      <>
        <AssistantMarkdown text={text} />
        <AssistantMarkdown text={text} />
      </>
    )
    const ids = Array.from(container.querySelectorAll('[id]'), (element) => element.id)
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
    for (const link of container.querySelectorAll('a[href^="#"]')) {
      const id = link.getAttribute('href')?.slice(1)
      expect(ids).toContain(id)
    }
  })
})
