import { createContext, useContext, useId } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { m } from '@b2b-saas-starter/i18n/messages'

const FootnoteLabel = createContext('footnote-label')
const remarkPlugins = [remarkGfm]
const components: Components = {
  h1: ({ children }) => <h3>{children}</h3>,
  h2: function Heading({ children, id, className }) {
    const label = useContext(FootnoteLabel)
    return (
      <h3 id={id === 'footnote-label' ? label : id} className={className}>
        {children}
      </h3>
    )
  },
  h3: ({ children }) => <h4>{children}</h4>,
  h4: ({ children }) => <h5>{children}</h5>,
  h5: ({ children }) => <h6>{children}</h6>,
  a: function Anchor({ node: _node, ...props }) {
    const label = useContext(FootnoteLabel)
    return props.href ? (
      <a
        {...props}
        aria-describedby={
          props['aria-describedby'] === 'footnote-label'
            ? label
            : props['aria-describedby']
        }
      >
        {props.children}
      </a>
    ) : (
      <span>{props.children}</span>
    )
  },
  img: ({ alt }) => <span>{alt}</span>,
  pre: ({ children }) => (
    // Keyboard users need focus to scroll wide code with arrow keys.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <pre tabIndex={0} aria-label={m.assistant_markdown_code()}>
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <section
      className="assistant-markdown-table"
      // Keyboard focus makes horizontal table scrolling available without a pointer.
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      aria-label={m.assistant_markdown_table()}
    >
      <table>{children}</table>
    </section>
  )
}

export function AssistantMarkdown({ text }: { readonly text: string }) {
  const id = useId()
  const footnoteLabel = `${id}-footnote-label`
  return (
    <FootnoteLabel value={footnoteLabel}>
      <div className="assistant-markdown">
        <Markdown
          skipHtml
          remarkPlugins={remarkPlugins}
          components={components}
          remarkRehypeOptions={{
            clobberPrefix: `${id}-`,
            footnoteLabel: m.assistant_markdown_footnotes(),
            footnoteBackLabel: (reference, rereference) =>
              m.assistant_markdown_back_reference({
                reference: reference + 1,
                occurrence: rereference
              })
          }}
        >
          {text}
        </Markdown>
      </div>
    </FootnoteLabel>
  )
}
