import { useOverflowFade } from '@/hooks/use-overflow-fade'
import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { GITHUB_URL } from '@/lib/github-url'
import { m } from '@b2b-saas-starter/i18n/messages'

type CodeTokenKind =
  | 'comment'
  | 'keyword'
  | 'string'
  | 'number'
  | 'function'
  | 'constant'
  | 'punctuation'
  | 'plain'

const TOKEN_PATTERN =
  /(\/\/[^\n]*|#[^\n]*|`[^`]*`|'[^'\n]*'|"[^"\n]*"|\b\d+(?:\.\d+)?\b|\b[A-Z][A-Z0-9_]+\b|\b(?:export|const|let|return|yield|function|async|await|new|type|readonly)\b|\b[a-zA-Z_$][\w$]*(?=\s*\()|[{}()[\].,:;<>])/g

const TOKEN_CLASSES = {
  comment: 'code-token-comment',
  keyword: 'code-token-keyword',
  string: 'code-token-string',
  number: 'code-token-number',
  function: 'code-token-function',
  constant: 'code-token-constant',
  punctuation: 'code-token-punctuation',
  plain: 'code-token-plain'
} satisfies Record<CodeTokenKind, string>

function tokenKind(token: string): CodeTokenKind {
  if (token.startsWith('//') || token.startsWith('#')) {
    return 'comment'
  }
  if (token.startsWith('`') || token.startsWith("'") || token.startsWith('"')) {
    return 'string'
  }
  if (/^\d/.test(token)) {
    return 'number'
  }
  if (/^[A-Z][A-Z0-9_]+$/.test(token)) {
    return 'constant'
  }
  if (
    /^(?:export|const|let|return|yield|function|async|await|new|type|readonly)$/.test(
      token
    )
  ) {
    return 'keyword'
  }
  if (/^[a-zA-Z_$][\w$]*$/.test(token)) {
    return 'function'
  }
  if (/^[{}()[\].,:;<>]$/.test(token)) {
    return 'punctuation'
  }
  return 'plain'
}

function HighlightedCode({ code }: { readonly code: string }) {
  return <>{highlightLine(code)}</>
}

function highlightLine(line: string): Array<ReactNode> {
  const parts: Array<ReactNode> = []
  let cursor = 0

  for (const match of line.matchAll(TOKEN_PATTERN)) {
    const token = match[0]
    const start = match.index
    if (start > cursor) {
      parts.push(line.slice(cursor, start))
    }
    parts.push(
      <span key={`${start}-${token}`} className={TOKEN_CLASSES[tokenKind(token)]}>
        {token}
      </span>
    )
    cursor = start + token.length
  }

  if (cursor < line.length) {
    parts.push(line.slice(cursor))
  }
  return parts
}

function SnippetPanel({
  label,
  code,
  path
}: {
  readonly label: string
  readonly code: string
  /** The real file the snippet is excerpted from, printed in the caption. */
  readonly path?: string | undefined
}) {
  const { ref, fadeRight } = useOverflowFade<HTMLPreElement>()

  return (
    <figure className="min-w-0 border border-border bg-card">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3 font-mono text-xs text-muted-foreground sm:px-5">
        <span className="break-words">{label}</span>
        {path === undefined ? null : (
          <a
            href={`${GITHUB_URL}/blob/master/${path}`}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 break-all py-1 text-sm underline underline-offset-4 hover:text-foreground max-md:min-h-11 max-md:content-center"
          >
            {path}
            <span className="sr-only">{m.common_opens_new_tab()}</span>
          </a>
        )}
      </figcaption>
      {/* The cap keeps a long body from setting the section's height; after
          the caller's truncation the code fits inside it, and the scroll is
          the safety net, not the reading experience. The right-edge mask is
          on only while code hides past the edge, so the scroll is visible
          before it is found. */}
      <pre
        ref={ref}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- <pre> is the semantic element for preformatted code; role="region" exposes the scrollable area without losing it.
        role="region"
        aria-label={m.showcase_scrollable_code({ label })}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need a focus stop to pan the overflowing code.
        tabIndex={0}
        className={cn(
          'max-h-120 overflow-auto p-4 font-mono text-xs leading-relaxed text-foreground sm:p-5 sm:text-sm',
          fadeRight &&
            '[mask-image:linear-gradient(to_right,black_calc(100%_-_2.5rem),transparent_100%)]'
        )}
      >
        <code data-code-theme>
          <HighlightedCode code={code} />
        </code>
      </pre>
    </figure>
  )
}

export { SnippetPanel }
