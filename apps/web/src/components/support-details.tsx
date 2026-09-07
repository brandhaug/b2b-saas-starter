import { useState } from 'react'
import { CopyIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import * as m from '@b2b-saas-starter/i18n/messages'

/** Callers supply only a static route label and already-authorized workspace data. */
export function SupportDetails({
  routeName,
  workspaceId,
  appVersion
}: {
  readonly routeName: 'help' | 'workspace' | 'application' | 'audit'
  readonly workspaceId?: string | undefined
  readonly appVersion?: string | undefined
}) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  async function copyDetails() {
    const details = [`Time (UTC): ${new Date().toISOString()}`, `Route: ${routeName}`]
    if (appVersion) {
      details.push(`App version: ${appVersion}`)
    }
    if (workspaceId) {
      details.push(`Workspace ID: ${workspaceId}`)
    }
    // No request reference is exposed by the current UI error contract.
    // Never replace it with a page trace or an incoming correlation header.
    // oxlint-disable-next-line effect/noTryCatch -- clipboard platform boundary; handle denied access and unsupported browsers without shipping Effect
    try {
      await navigator.clipboard.writeText(details.join('\n'))
      setStatus('copied')
    } catch {
      setStatus('failed')
    }
  }
  return (
    <div className="grid justify-items-start gap-2">
      <Button type="button" variant="outline" onClick={() => void copyDetails()}>
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
