import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseSync } from 'oxc-parser'

type Comment = { start: number; end: number; line: number; text: string }
type Directive = {
  directive: string
  rules: Array<string>
  scope: string
  reason: string
}
type Entry = Directive & { path: string; line: number; category: string }

// Use the parser's comment list, rather than scanning raw source. In particular,
// template strings, regex literals and JSX text must never become directives.
function commentsIn(path: string, text: string): Array<Comment> {
  const parsed = parseSync(path, text)
  if (parsed.errors.length) {
    throw new Error(
      `Cannot inventory ${path}: ${parsed.errors.map(({ message }) => message).join('; ')}`
    )
  }
  return parsed.comments.map((range) => ({
    start: range.start,
    end: range.end,
    line: text.slice(0, range.start).split('\n').length,
    text: range.value
      .split(/\r?\n/u)
      .map((line) => line.trim().replace(/^\*\s?/u, ''))
      .join(' ')
      .trim()
  }))
}

function lintScope(action: string) {
  switch (action) {
    case 'disable-next-line': {
      return 'next line'
    }
    case 'disable-line': {
      return 'same line'
    }
    case 'enable': {
      return 'restore rules from directive'
    }
    default: {
      return 'file from directive; see enable controls'
    }
  }
}

function parseDirective(text: string): Directive | undefined {
  const lint =
    /^(oxlint|eslint)-(disable-next-line|disable-line|disable|enable)\b(.*)$/u.exec(
      text
    )
  if (lint) {
    const [, tool, action, tail = ''] = lint
    const [ruleText = '', ...reason] = tail.split(/\s+--\s*/u)
    const rules = ruleText
      .trim()
      .split(/[\s,]+/u)
      .filter(Boolean)
    return {
      directive: `${tool}-${action}`,
      rules: rules.length ? rules : ['*'],
      scope: lintScope(action ?? ''),
      reason: reason.join(' -- ').trim()
    }
  }
  const typescript = /^@ts-(expect-error|ignore|nocheck)\b\s*(?::|--)?\s*(.*)$/u.exec(
    text
  )
  if (typescript) {
    return {
      directive: `@ts-${typescript[1]}`,
      rules: ['TypeScript'],
      scope: typescript[1] === 'nocheck' ? 'whole file' : 'next line',
      reason: typescript[2] ?? ''
    }
  }
  const effect = /^@effect-diagnostics(-next-line)?\s+(.*)$/u.exec(text)
  if (effect) {
    const [settings = '', ...reason] = (effect[2] ?? '').split(/\s+--\s*/u)
    const rules = [...settings.matchAll(/(?:^|[\s,])([\w*]+):off\b/gu)].map(
      (match) => match[1] ?? ''
    )
    if (rules.length) {
      return {
        directive: `@effect-diagnostics${effect[1] ?? ''}`,
        rules,
        scope: effect[1] ? 'next line' : 'whole file',
        reason: reason.join(' -- ').trim()
      }
    }
  }
  return undefined
}

function categoryFor(path: string, directive: Directive, reason: string) {
  if (directive.directive.endsWith('-enable')) {
    return 'restore control'
  }
  if (
    directive.directive === '@ts-expect-error' &&
    /(?:\.(?:test|spec)\.|\/test[s]?\/)/u.test(path)
  ) {
    return 'negative type test'
  }
  if (
    /\b(?:TODO|FIXME|workaround|temporary (?:suppression|exception|fix|hack|debt))\b/iu.test(
      reason
    )
  ) {
    return 'temporary debt marker'
  }
  if (
    /\b(?:boundary|interop|adapter|native|callback|port|wire|browser|promise-shaped)\b/iu.test(
      reason
    )
  ) {
    return 'boundary explanation'
  }
  return reason ? 'explained exception' : 'unclassified'
}

export function inventorySource(path: string, text: string): Array<Entry> {
  const comments = commentsIn(path, text)
  const entries: Array<Entry> = []
  for (const [index, comment] of comments.entries()) {
    const directive = parseDirective(comment.text)
    if (!directive) {
      continue
    }
    const before: Array<string> = []
    const after: Array<string> = []
    for (const direction of [-1, 1]) {
      let edge = comment
      for (
        let cursor = index + direction;
        cursor >= 0 && cursor < comments.length;
        cursor += direction
      ) {
        const adjacent = comments[cursor]
        if (
          !adjacent ||
          parseDirective(adjacent.text) ||
          /^@effect-diagnostics\b/u.test(adjacent.text)
        ) {
          break
        }
        const gap =
          direction < 0
            ? text.slice(adjacent.end, edge.start)
            : text.slice(edge.end, adjacent.start)
        if (!/^\s*$/u.test(gap) || (gap.match(/\n/gu)?.length ?? 0) > 1) {
          break
        }
        if (direction < 0) {
          before.unshift(adjacent.text)
        } else {
          after.push(adjacent.text)
        }
        edge = adjacent
      }
    }
    const reason = [...before, directive.reason, ...after].filter(Boolean).join(' ')
    entries.push({
      ...directive,
      path,
      line: comment.line,
      reason,
      category: categoryFor(path, directive, reason)
    })
  }
  return entries
}

function included(path: string) {
  return (
    /\.(?:[cm]?[jt]sx?)$/u.test(path) &&
    !/^(?:vendor|node_modules|\.agents|\.claude|\.context)\//u.test(path) &&
    !/(?:^|\/)(?:node_modules|dist|dist-e2e|\.output|coverage|\.wrangler|\.generated)\//u.test(
      path
    ) &&
    !path.startsWith('packages/i18n/src/generated/') &&
    !/(?:^|\/)routeTree\.gen\./u.test(path)
  )
}

function cell(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;')
    .replaceAll('`', '&#96;')
    .replaceAll('[', '&#91;')
    .replaceAll(']', '&#93;')
}

function reportFor(root: string) {
  const paths = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' }
  )
    .split('\0')
    .filter(included)
  const entries = [...new Set(paths)]
    .toSorted()
    .flatMap((path) => inventorySource(path, readFileSync(join(root, path), 'utf8')))
  const rows = entries.map((entry) => {
    const link = `../../${entry.path.split('/').map(encodeURIComponent).join('/')}#L${entry.line}`
    return `| [${cell(entry.path)}:${entry.line}](${link}) | ${cell(entry.directive)} | ${cell(entry.rules.join(', '))} | ${entry.scope} | ${entry.category} | ${cell(entry.reason || 'No explanation associated by the documented rule.')} |`
  })
  return [
    '# Suppression inventory',
    '',
    'Generated by `pnpm run suppressions:generate`. Do not edit this report.',
    '',
    'See [coverage, explanation association and classification limits](../suppression-inventory.md).',
    '',
    `${entries.filter((entry) => entry.category !== 'restore control').length} suppression directives; ${entries.filter((entry) => entry.category === 'restore control').length} restore controls. Counts are descriptive, not a quality gate.`,
    '',
    '<!-- prettier-ignore -->',
    '| Source | Directive | Rules | Scope | Classification | Explanation |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    ''
  ].join('\n')
}

function main() {
  const args = process.argv.slice(2)
  const mode = args[0]
  if (
    (mode !== '--write' && mode !== '--check') ||
    (args.length !== 1 && (args.length !== 3 || args[1] !== '--root'))
  ) {
    throw new Error('Usage: suppression-inventory.ts --write|--check [--root PATH]')
  }
  const root = resolve(args[2] ?? join(import.meta.dirname, '..'))
  const output = join(root, 'docs/generated/suppressions.md')
  const report = reportFor(root)
  if (mode === '--write') {
    mkdirSync(join(root, 'docs/generated'), { recursive: true })
    writeFileSync(output, report)
  } else if (readFileSync(output, 'utf8') !== report) {
    console.error(
      'Suppression inventory is stale. Run pnpm run suppressions:generate and review the diff.'
    )
    process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main()
}
