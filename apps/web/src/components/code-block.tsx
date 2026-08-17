import { cn } from '@/lib/utils'

export function CodeBlock({
  language,
  code,
  className
}: {
  readonly language: string
  readonly code: string
  readonly className?: string
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-border bg-card',
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          {language}
        </span>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-foreground">
        {/* oxlint-disable-next-line better-tailwindcss/no-concatenated-classes -- `language-*` is the syntax-highlighter's hook class, not a Tailwind utility, so Tailwind has nothing to purge */}
        <code className={`language-${language}`}>{code}</code>
      </pre>
    </div>
  )
}
