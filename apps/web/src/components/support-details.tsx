import { useClipboard } from '@/hooks/use-clipboard'
import { CopyIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import * as m from '@b2b-saas-starter/i18n/messages'

/** Callers supply only a static route label and already-authorized workspace data. */
export function SupportDetails({
  routeName,
  workspaceId,
  appVersion
}: {
  readonly routeName: 'help' | 'workspace' | 'application'
  readonly workspaceId?: string | undefined
  readonly appVersion?: string | undefined
}) {
  const details = [`Route: ${routeName}`]
  if (appVersion) {
    details.push(`App version: ${appVersion}`)
  }
  if (workspaceId) {
    details.push(`Workspace ID: ${workspaceId}`)
  }
  const value = details.join('\n')
  const { status, copy } = useClipboard(value)
  async function copyDetails() {
    // No request reference is exposed by the current UI error contract.
    // Never replace it with a page trace or an incoming correlation header.
    await copy(`Time (UTC): ${new Date().toISOString()}\n${value}`)
  }
  return (
    <div className="grid justify-items-start gap-2">
      <Button
        type="button"
        variant="outline"
        aria-disabled={status === 'pending'}
        onClick={() => void copyDetails()}
      >
        <CopyIcon className="size-4" />
        {m.support_copy_details()}
      </Button>
      <output aria-live="polite" className="text-sm text-muted-foreground">
        {status === 'copied' ? m.support_details_copied() : null}
        {status === 'failed' ? m.support_details_copy_failed() : null}
      </output>
    </div>
  )
}
