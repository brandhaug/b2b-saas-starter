/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- Scrollable diagnostic text needs keyboard focus for arrow-key scrolling. */
import { useId, useState } from 'react'
import { CopyIcon, WrapTextIcon } from 'lucide-react'
import { m } from '@b2b-saas-starter/i18n/messages'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useClipboard } from '@/hooks/use-clipboard'

/** Displays already-authorized diagnostic text without interpreting it as markup. */
export function EvidenceCode({
  label,
  value
}: {
  readonly label: string
  readonly value: string
}) {
  const labelId = useId()
  const [wrap, setWrap] = useState(true)
  const { status: copyStatus, copy } = useClipboard(value)

  return (
    <div className="min-w-0 border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-1">
        <span id={labelId} className="text-sm font-medium">
          {label}
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={m.evidence_wrap_lines()}
            aria-pressed={wrap}
            onClick={() => setWrap((current) => !current)}
          >
            <WrapTextIcon />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={m.evidence_copy_named({ label })}
            aria-disabled={copyStatus === 'pending'}
            onClick={() => void copy()}
          >
            <CopyIcon />
          </Button>
        </div>
      </div>
      {/* Keyboard users must be able to scroll long evidence independently. */}
      <pre
        aria-labelledby={labelId}
        tabIndex={0}
        className={cn(
          'max-h-80 overflow-auto p-3 font-mono text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          wrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre'
        )}
      >
        <code>{value}</code>
      </pre>
      <output
        aria-live="polite"
        className={cn(
          'block text-sm',
          (copyStatus === 'copied' || copyStatus === 'failed') &&
            'border-t border-border px-3 py-2',
          copyStatus === 'failed' ? 'text-destructive' : 'text-status-ok'
        )}
      >
        {copyStatus === 'copied' ? m.copy_success() : null}
        {copyStatus === 'failed' ? m.evidence_copy_failed() : null}
      </output>
    </div>
  )
}
