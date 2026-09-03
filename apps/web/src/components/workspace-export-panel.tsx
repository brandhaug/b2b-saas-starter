import { type WorkspaceExport } from '@b2b-saas-starter/capabilities/governance/workspace-export'

import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { formatUtc, formatUtcOr } from '@/lib/format-date'
import {
  requestWorkspaceExportServerFn,
  type WorkspaceExportsSegment
} from '@/lib/server/workspace-exports'

const REQUEST_FAILED = 'Failed to request the export'

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
  return ` · ${(sizeBytes / 1024).toFixed(1)} KB`
}

/**
 * The owner's export card (ADR 0054). Rendered only when the loader handed the
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
    failureMessage: REQUEST_FAILED
  })

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        A ZIP of members, invitations, API token metadata, webhook endpoints with their
        deliveries, audit events, notifications, and the workspace record, with a README
        describing every file. Archives are kept for seven days.
      </p>
      {segment.availability.available ? (
        <Button
          type="button"
          onClick={() => request.run()}
          disabled={request.pending}
          className="justify-self-start"
        >
          {request.pending ? <Spinner /> : null}
          Request export
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">{segment.availability.reason}</p>
      )}
      {segment.exports.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No exports yet</EmptyTitle>
            <EmptyDescription>
              Requested exports appear here with a download link once they are built.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup>
          {segment.exports.map((row) => (
            <Item key={row.id} variant="outline" size="sm">
              <ItemContent>
                <ItemTitle>
                  Requested {formatUtc(row.requestedAt)}
                  <Badge variant={workspaceExportStatusVariant(row.status)}>
                    {row.status}
                  </Badge>
                </ItemTitle>
                <ItemDescription>
                  {row.status === 'ready'
                    ? `Available until ${formatUtcOr(row.expiresAt, 'unknown')}${formatSize(row.sizeBytes)}`
                    : null}
                  {row.status === 'pending' ? 'Building in the background.' : null}
                  {row.status === 'failed'
                    ? `Failed${row.failureReason === null ? '' : `: ${row.failureReason}`}`
                    : null}
                </ItemDescription>
              </ItemContent>
              {row.downloadUrl === null ? null : (
                <ItemActions>
                  {/* The link is signed and time-limited; the browser follows it
                      straight to the API worker, which streams the ZIP. */}
                  <Button
                    variant="outline"
                    size="sm"
                    render={
                      <a href={row.downloadUrl} download aria-label="Download ZIP" />
                    }
                  >
                    Download ZIP
                  </Button>
                </ItemActions>
              )}
            </Item>
          ))}
        </ItemGroup>
      )}
      {request.error === null ? null : (
        <Alert variant="destructive">
          <AlertDescription>{request.error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
