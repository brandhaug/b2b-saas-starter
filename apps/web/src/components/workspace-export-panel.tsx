import { authFailure } from '@/lib/auth-result'
import { statusLabel } from '@/lib/value-labels'
import { type WorkspaceExport } from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { toast } from 'sonner'

import { ActionFeedback } from '@/components/page/action-feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle
} from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { useServerAction } from '@/hooks/use-server-action'
import { workspaceExportStatusVariant } from '@/lib/badge-variants'
import { formatTimestamp, formatTimestampOr } from '@/lib/format-date'
import {
  requestWorkspaceExportServerFn,
  downloadWorkspaceExportServerFn,
  type WorkspaceExportsSegment
} from '@/lib/server/workspace-exports'
import { m } from '@b2b-saas-starter/i18n/messages'
import { getLocale } from '@b2b-saas-starter/i18n/runtime'
import { formatNumber } from '@b2b-saas-starter/i18n/format'

/** Requesting an export, as a port — same shape as `RevokeApiToken`. */
export type RequestWorkspaceExport = (input: {
  readonly data: { readonly workspaceSlug: string }
}) => Promise<WorkspaceExport>

function formatSize(sizeBytes: number | null): string {
  if (sizeBytes === null) {
    return ''
  }
  if (sizeBytes < 1024) {
    return ` · ${sizeBytes} B`
  }
  return ` · ${formatNumber(sizeBytes / 1024, getLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB`
}

/**
 * The owner's export card (ADR 0055). Rendered only when the loader handed the
 * segment over — the loader withholds it from admins and members, so absence is
 * the denial and this component never checks a role. When the deployment has
 * no export bucket the segment says so and the button is replaced by the
 * reason; otherwise the owner requests an archive and downloads ready ones
 * through their signed links.
 */
export function WorkspaceExportPanel({
  workspaceSlug,
  segment,
  requestExport = requestWorkspaceExportServerFn
}: {
  readonly workspaceSlug: string
  readonly segment: WorkspaceExportsSegment
  readonly requestExport?: RequestWorkspaceExport
}) {
  // The loader owns the list, so the hook re-runs it on success rather than
  // mirroring the new row into local state.
  const request = useServerAction(() => requestExport({ data: { workspaceSlug } }), {
    failureMessage: m.export_request_failed(),
    onSuccess: () => {
      // The row's pending badge is the fuller story; this only confirms the
      // workspace accepted the request.
      toast.success(m.export_requested())
    }
  })

  const download = useServerAction(
    async (exportId: string) => {
      const url = await downloadWorkspaceExportServerFn({
        data: { workspaceSlug, exportId }
      })
      if (url === null) {
        return authFailure(m.export_download_failed())
      }
      window.location.assign(url)
      return true
    },
    { failureMessage: m.export_download_failed(), invalidate: false }
  )

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{m.export_description()}</p>
      {segment.availability.available ? (
        <Button
          type="button"
          onClick={() => request.run()}
          disabled={request.pending}
          className="justify-self-start"
        >
          {request.pending ? <Spinner /> : null}
          {m.request_export()}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">{segment.availability.reason}</p>
      )}
      {segment.exports.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{m.empty_no_exports()}</EmptyTitle>
            <EmptyDescription>{m.export_empty_description()}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup>
          {segment.exports.map((row) => (
            <Item key={row.id} variant="outline" size="sm">
              <ItemContent>
                <ItemTitle>
                  {m.export_requested_at({ time: formatTimestamp(row.requestedAt) })}
                  <Badge variant={workspaceExportStatusVariant(row.status)}>
                    {statusLabel(row.status)}
                  </Badge>
                </ItemTitle>
                <ItemDescription>
                  {row.status === 'ready'
                    ? m.export_available_until({
                        time: formatTimestampOr(row.expiresAt, m.unknown_value())
                      }) + formatSize(row.sizeBytes)
                    : null}
                  {row.status === 'pending' ? m.export_building() : null}
                  {row.status === 'failed'
                    ? m.export_failed({
                        reason:
                          row.failureReason === null ? '' : `: ${row.failureReason}`
                      })
                    : null}
                </ItemDescription>
              </ItemContent>
              {row.status === 'ready' ? (
                <ItemActions>
                  <Button
                    variant="outline"
                    onClick={() => download.run(row.id)}
                    disabled={download.pending}
                  >
                    {download.pendingInput === row.id ? <Spinner /> : null}
                    {m.action_download_archive()}
                  </Button>
                </ItemActions>
              ) : null}
            </Item>
          ))}
        </ItemGroup>
      )}
      <ActionFeedback error={request.error ?? download.error} />
    </div>
  )
}
