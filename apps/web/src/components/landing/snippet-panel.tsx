import { useOverflowFade } from '@/hooks/use-overflow-fade'
import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

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
      <figcaption className="flex items-baseline justify-between gap-4 border-b border-border px-4 py-2 font-mono text-xs text-muted-foreground">
        <span className="shrink-0">{label}</span>
        {path === undefined ? null : (
          <span className="truncate text-2xs" title={path}>
            {path}
          </span>
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
        aria-label={`${label}, scrollable code`}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need a focus stop to pan the overflowing code.
        tabIndex={0}
        className={cn(
          'max-h-108 overflow-auto p-4 font-mono text-xs leading-normal text-foreground/90',
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
