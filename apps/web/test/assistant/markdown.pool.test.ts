import { createElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { expect, it } from 'vite-plus/test'
import { AssistantMarkdown } from '../../src/components/assistant-markdown'

it('renders assistant Markdown inside workerd without DOM globals or image preloads', async () => {
  const text =
    '# Answer\n\n- **Saved** result\n\n```ts\nconst value = 1\n```\n\n| State | Count |\n| --- | --- |\n| Ready | 2 |\n\n![Evidence](https://images.example/pixel.png)'
  const stream = await renderToReadableStream(
    createElement(AssistantMarkdown, { text })
  )
  const html = await new Response(stream).text()
  expect(html).toContain('<strong>Saved</strong>')
  expect(html).toContain('<table>')
  expect(html).toContain('const value = 1')
  expect(html).not.toContain('<h1')
  expect(html).not.toContain('<img')
  expect(html).not.toContain('<link')
  expect(html).not.toContain('images.example')
})
